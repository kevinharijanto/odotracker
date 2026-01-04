require('dotenv').config();

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'odotracker.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

/**
 * Initialize database with schema
 */
function initDb() {
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);

    // Migration: Check if vehicles table has vehicle_type column
    try {
        const tableInfo = db.prepare("PRAGMA table_info(vehicles)").all();
        const hasVehicleType = tableInfo.some(col => col.name === 'vehicle_type');

        if (!hasVehicleType) {
            console.log('🔄 Migrating: Adding vehicle_type column to vehicles table...');
            db.prepare("ALTER TABLE vehicles ADD COLUMN vehicle_type TEXT DEFAULT 'car'").run();
        }
    } catch (e) {
        console.error('Migration error:', e.message);
    }

    // Migration: Check for time-based columns in service_types
    try {
        const stInfo = db.prepare("PRAGMA table_info(service_types)").all();
        if (!stInfo.some(col => col.name === 'interval_days')) {
            console.log('🔄 Migrating: Adding time-based columns to service_types...');
            db.prepare("ALTER TABLE service_types ADD COLUMN interval_days INTEGER").run();
            db.prepare("ALTER TABLE service_types ADD COLUMN last_service_date DATETIME").run();
        }
    } catch (e) {
        console.error('Migration error (service_types):', e.message);
    }


    // Migration: Check if interval_km in service_types allows NULL
    try {
        const stInfo = db.prepare("PRAGMA table_info(service_types)").all();
        const intervalKm = stInfo.find(col => col.name === 'interval_km');

        if (intervalKm && intervalKm.notnull === 1) {
            console.log('🔄 Migrating: Removing NOT NULL constraint from service_types.interval_km...');

            db.pragma('foreign_keys = OFF');

            const migrate = db.transaction(() => {
                // Create new table
                db.prepare(`
                    CREATE TABLE IF NOT EXISTS service_types_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        vehicle_id INTEGER NOT NULL,
                        name TEXT NOT NULL,
                        interval_km INTEGER,
                        interval_days INTEGER,
                        last_service_odo INTEGER DEFAULT 0,
                        last_service_date DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
                    )
                `).run();

                // Copy data
                db.prepare(`
                    INSERT INTO service_types_new (id, vehicle_id, name, interval_km, interval_days, last_service_odo, last_service_date, created_at)
                    SELECT id, vehicle_id, name, interval_km, interval_days, last_service_odo, last_service_date, created_at FROM service_types
                `).run();

                // Swap tables
                db.prepare("DROP TABLE service_types").run();
                db.prepare("ALTER TABLE service_types_new RENAME TO service_types").run();

                // Recreate indexes
                db.prepare("CREATE INDEX IF NOT EXISTS idx_service_types_vehicle ON service_types(vehicle_id)").run();
            });

            migrate();

            db.pragma('foreign_keys = ON');
            console.log('✅ Migration complete: interval_km is now nullable');
        }
    } catch (e) {
        console.error('Migration error (Fix NOT NULL):', e.message);
        try { db.pragma('foreign_keys = ON'); } catch { }
    }

    // Migration: Create admin tables for allowed users and access requests
    try {
        db.prepare(`
            CREATE TABLE IF NOT EXISTS allowed_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL UNIQUE,
                notes TEXT,
                added_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        db.prepare(`
            CREATE TABLE IF NOT EXISTS access_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL UNIQUE,
                username TEXT,
                first_name TEXT,
                attempt_count INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();

        db.prepare('CREATE INDEX IF NOT EXISTS idx_allowed_users_telegram ON allowed_users(telegram_id)').run();
        db.prepare('CREATE INDEX IF NOT EXISTS idx_access_requests_telegram ON access_requests(telegram_id)').run();
    } catch (e) {
        console.error('Migration error (admin tables):', e.message);
    }

    console.log('✅ Database initialized');
}

// ===================== USERS =====================

function getOrCreateUser(telegramId, username, firstName) {
    let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    if (!user) {
        const stmt = db.prepare(`
            INSERT INTO users (telegram_id, username, first_name)
            VALUES (?, ?, ?)
        `);
        const result = stmt.run(telegramId, username, firstName);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }
    return user;
}

function updateUserReminder(userId, reminderTime, enabled = true) {
    db.prepare(`
        UPDATE users SET reminder_time = ?, reminder_enabled = ?
        WHERE id = ?
    `).run(reminderTime, enabled ? 1 : 0, userId);
}

function getUsersWithReminders() {
    return db.prepare('SELECT * FROM users WHERE reminder_enabled = 1').all();
}

function getUserById(userId) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

// ===================== VEHICLES =====================

function addVehicle(userId, name, plate, initialKm = 0, vehicleType = 'car') {
    const stmt = db.prepare(`
        INSERT INTO vehicles (user_id, name, plate, current_odo, vehicle_type)
        VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(userId, name, plate, initialKm, vehicleType);
    return result.lastInsertRowid;
}

function getVehiclesByUser(userId) {
    return db.prepare('SELECT * FROM vehicles WHERE user_id = ? ORDER BY name').all(userId);
}

function getVehicleById(vehicleId) {
    return db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
}

function updateVehicleOdo(vehicleId, odoKm) {
    db.prepare('UPDATE vehicles SET current_odo = ? WHERE id = ?').run(odoKm, vehicleId);
}

function deleteVehicle(vehicleId) {
    db.prepare('DELETE FROM odometer_readings WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM service_events WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM service_types WHERE vehicle_id = ?').run(vehicleId);
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
}

function updateVehicle(vehicleId, updates) {
    const allowedFields = ['name', 'plate'];
    const setClauses = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            setClauses.push(`${key} = ?`);
            values.push(value);
        }
    }

    if (setClauses.length > 0) {
        values.push(vehicleId);
        db.prepare(`UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    }
}

// ===================== SERVICE TYPES =====================

function addServiceType(vehicleId, name, intervalKm = 5000, intervalDays = null) {
    const stmt = db.prepare(`
        INSERT INTO service_types (vehicle_id, name, interval_km, interval_days, last_service_date)
        VALUES (?, ?, ?, ?, ?)
    `);
    // Default last_service_date to now if time-based
    const lastDate = intervalDays ? new Date().toISOString() : null;
    const result = stmt.run(vehicleId, name, intervalKm, intervalDays, lastDate);
    return result.lastInsertRowid;
}

function getServiceTypesByVehicle(vehicleId) {
    return db.prepare('SELECT * FROM service_types WHERE vehicle_id = ? ORDER BY name').all(vehicleId);
}

function getServiceTypeById(serviceTypeId) {
    return db.prepare('SELECT * FROM service_types WHERE id = ?').get(serviceTypeId);
}

function updateServiceType(serviceTypeId, updates) {
    const allowedFields = ['name', 'interval_km', 'interval_days', 'last_service_odo', 'last_service_date'];
    const setClauses = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
            setClauses.push(`${key} = ?`);
            values.push(value);
        }
    }

    if (setClauses.length > 0) {
        values.push(serviceTypeId);
        db.prepare(`UPDATE service_types SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    }
}

function deleteServiceType(serviceTypeId) {
    db.prepare('DELETE FROM service_types WHERE id = ?').run(serviceTypeId);
}

function getServiceStatus(serviceType, currentOdo) {
    const status = {
        name: serviceType.name,
        isOverdue: false,
        remainingKm: null,
        remainingDays: null,
        percentage: 0,
        type: 'km', // 'km', 'time', 'both'
        summary: ''
    };

    // Calculate KM status
    if (serviceType.interval_km) {
        const driven = currentOdo - serviceType.last_service_odo;
        const remaining = serviceType.interval_km - driven;
        status.remainingKm = remaining;
        status.percentage = Math.min(100, (driven / serviceType.interval_km) * 100);

        if (remaining <= 0) status.isOverdue = true;
    }

    // Calculate Time status
    if (serviceType.interval_days) {
        const lastDate = serviceType.last_service_date ? new Date(serviceType.last_service_date) : new Date(serviceType.created_at);
        const nextDate = new Date(lastDate);
        nextDate.setDate(lastDate.getDate() + serviceType.interval_days);

        const now = new Date();
        const diffTime = nextDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        status.remainingDays = diffDays;

        // Calculate percentage for time
        const totalDuration = serviceType.interval_days * 24 * 60 * 60 * 1000;
        const elapsed = now - lastDate;
        const timePerc = Math.min(100, (elapsed / totalDuration) * 100);
        status.percentage = Math.max(status.percentage, timePerc);

        if (diffDays <= 0) status.isOverdue = true;

        if (serviceType.interval_km) status.type = 'both';
        else status.type = 'time';
    }

    // Legacy support property for existing sort logic (prefer KM if both)
    status.remaining = status.remainingKm !== null ? status.remainingKm : (status.remainingDays * 100); // Hacky sort helper?
    // Actually, let's keep it clean.

    return status;
}

/**
 * Get all service types for a vehicle with their status
 */
function getServiceStatusForVehicle(vehicleId) {
    const vehicle = getVehicleById(vehicleId);
    if (!vehicle) return [];

    const serviceTypes = getServiceTypesByVehicle(vehicleId);
    return serviceTypes.map(st => ({
        ...st,
        status: getServiceStatus(st, vehicle.current_odo)
    }));
}

/**
 * Get all service types needing attention across all vehicles for a user
 */
function getServicesNeedingAttention(userId, kmThreshold = 500, daysThreshold = 7) {
    const vehicles = getVehiclesByUser(userId);
    const results = [];

    for (const vehicle of vehicles) {
        const serviceTypes = getServiceTypesByVehicle(vehicle.id);
        for (const st of serviceTypes) {
            const status = getServiceStatus(st, vehicle.current_odo);

            let attentionNeeded = false;
            if (status.isOverdue) attentionNeeded = true;
            if (status.remainingKm !== null && status.remainingKm <= kmThreshold) attentionNeeded = true;
            if (status.remainingDays !== null && status.remainingDays <= daysThreshold) attentionNeeded = true;

            if (attentionNeeded) {
                results.push({
                    vehicle,
                    serviceType: st,
                    status
                });
            }
        }
    }

    // Sort by urgency (overdue first, then close by km, then close by time)
    return results.sort((a, b) => b.status.percentage - a.status.percentage);
}

// ===================== ODOMETER READINGS =====================

function logOdometer(vehicleId, odoKm, photoPath = null, ocrRaw = null, source = 'manual') {
    const stmt = db.prepare(`
        INSERT INTO odometer_readings (vehicle_id, odo_km, photo_path, ocr_raw, source)
        VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(vehicleId, odoKm, photoPath, ocrRaw, source);
    updateVehicleOdo(vehicleId, odoKm);
    return result.lastInsertRowid;
}

function getOdometerHistory(vehicleId, limit = 10) {
    return db.prepare(`
        SELECT * FROM odometer_readings 
        WHERE vehicle_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
    `).all(vehicleId, limit);
}

function getLatestOdometer(vehicleId) {
    return db.prepare(`
        SELECT * FROM odometer_readings 
        WHERE vehicle_id = ? 
        ORDER BY created_at DESC 
        LIMIT 1
    `).get(vehicleId);
}

// ===================== SERVICE EVENTS =====================

function logService(vehicleId, serviceTypeId, odoKm, notes = null, cost = null) {
    const serviceType = getServiceTypeById(serviceTypeId);
    if (!serviceType) throw new Error('Service type not found');

    const stmt = db.prepare(`
        INSERT INTO service_events (vehicle_id, service_type_id, service_type_name, odo_km, notes, cost)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(vehicleId, serviceTypeId, serviceType.name, odoKm, notes, cost);

    // Update last service odometer for this service type
    updateServiceType(serviceTypeId, { last_service_odo: odoKm });

    // Also update vehicle's current odometer if this reading is higher
    const vehicle = getVehicleById(vehicleId);
    if (vehicle && odoKm > vehicle.current_odo) {
        updateVehicleOdo(vehicleId, odoKm);
    }

    return result.lastInsertRowid;
}

function getServiceHistory(vehicleId, limit = 10) {
    return db.prepare(`
        SELECT * FROM service_events 
        WHERE vehicle_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
    `).all(vehicleId, limit);
}

function getLatestServiceForType(serviceTypeId) {
    return db.prepare(`
        SELECT * FROM service_events 
        WHERE service_type_id = ? 
        ORDER BY created_at DESC 
        LIMIT 1
    `).get(serviceTypeId);
}

// ===================== ADMIN FUNCTIONS =====================

/**
 * Add a user to the allowed list
 */
function addAllowedUser(telegramId, notes = null, addedBy = null) {
    const existing = db.prepare('SELECT * FROM allowed_users WHERE telegram_id = ?').get(telegramId);
    if (existing) {
        throw new Error('User already in allowed list');
    }
    const stmt = db.prepare(`
        INSERT INTO allowed_users (telegram_id, notes, added_by)
        VALUES (?, ?, ?)
    `);
    return stmt.run(telegramId, notes, addedBy);
}

/**
 * Remove a user from the allowed list
 */
function removeAllowedUser(telegramId) {
    return db.prepare('DELETE FROM allowed_users WHERE telegram_id = ?').run(telegramId);
}

/**
 * Get all allowed users
 */
function getAllowedUsers() {
    return db.prepare('SELECT * FROM allowed_users ORDER BY created_at DESC').all();
}

/**
 * Check if a user is allowed
 */
function isUserAllowed(telegramId) {
    const user = db.prepare('SELECT * FROM allowed_users WHERE telegram_id = ?').get(telegramId);
    return !!user;
}

/**
 * Log an access request from an unauthorized user
 */
function logAccessRequest(telegramId, username, firstName) {
    const existing = db.prepare('SELECT * FROM access_requests WHERE telegram_id = ?').get(telegramId);

    if (existing) {
        // Update attempt count and last attempt time
        db.prepare(`
            UPDATE access_requests 
            SET attempt_count = attempt_count + 1, 
                last_attempt = CURRENT_TIMESTAMP,
                username = COALESCE(?, username),
                first_name = COALESCE(?, first_name)
            WHERE telegram_id = ?
        `).run(username, firstName, telegramId);
    } else {
        db.prepare(`
            INSERT INTO access_requests (telegram_id, username, first_name)
            VALUES (?, ?, ?)
        `).run(telegramId, username, firstName);
    }
}

/**
 * Get all access requests
 */
function getAccessRequests() {
    return db.prepare('SELECT * FROM access_requests ORDER BY last_attempt DESC').all();
}

/**
 * Remove an access request
 */
function removeAccessRequest(telegramId) {
    return db.prepare('DELETE FROM access_requests WHERE telegram_id = ?').run(telegramId);
}

/**
 * Clear all access requests
 */
function clearAccessRequests() {
    return db.prepare('DELETE FROM access_requests').run();
}

/**
 * Get admins from database (for future use - currently uses env var)
 */
function getAdmins() {
    // Could expand this to have a dedicated admins table
    // For now, just return empty - admins are defined via ADMIN_USER_IDS env var
    return [];
}

/**
 * Get admin stats
 */
function getAdminStats() {
    const allowedUsers = db.prepare('SELECT COUNT(*) as count FROM allowed_users').get().count;
    const pendingRequests = db.prepare('SELECT COUNT(*) as count FROM access_requests').get().count;
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    return {
        allowedUsers,
        pendingRequests,
        totalUsers
    };
}

module.exports = {
    db,
    initDb,
    // Users
    getOrCreateUser,
    updateUserReminder,
    getUsersWithReminders,
    getUserById,
    // Vehicles
    addVehicle,
    getVehiclesByUser,
    getVehicleById,
    updateVehicleOdo,
    deleteVehicle,
    updateVehicle,
    // Service Types
    addServiceType,
    getServiceTypesByVehicle,
    getServiceTypeById,
    updateServiceType,
    deleteServiceType,
    getServiceStatus,
    getServiceStatusForVehicle,
    getServicesNeedingAttention,
    // Odometer
    logOdometer,
    getOdometerHistory,
    getLatestOdometer,
    // Service Events
    logService,
    getServiceHistory,
    getLatestServiceForType,
    // Admin
    addAllowedUser,
    removeAllowedUser,
    getAllowedUsers,
    isUserAllowed,
    logAccessRequest,
    getAccessRequests,
    removeAccessRequest,
    clearAccessRequests,
    getAdmins,
    getAdminStats
};

