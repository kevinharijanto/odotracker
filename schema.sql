-- Users table for multi-user support
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    reminder_time TEXT DEFAULT '20:00',
    reminder_enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Vehicles table (simplified - no more single service interval)
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    plate TEXT,
    vehicle_type TEXT DEFAULT 'car',  -- 'car' or 'motorcycle'
    current_odo INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Service types per vehicle (multiple service intervals)
CREATE TABLE IF NOT EXISTS service_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    name TEXT NOT NULL,  -- e.g., "Oil Change", "Tire Rotation"
    interval_km INTEGER, -- NULL if time-based only
    interval_days INTEGER, -- NULL if km-based only (e.g., 14 for 2 weeks)
    last_service_odo INTEGER DEFAULT 0,
    last_service_date DATETIME, -- ISO string YYYY-MM-DD
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
);

-- Odometer readings with OCR data
CREATE TABLE IF NOT EXISTS odometer_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    odo_km INTEGER NOT NULL,
    photo_path TEXT,
    ocr_raw TEXT,
    source TEXT DEFAULT 'manual',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
);

-- Service events linked to service types
CREATE TABLE IF NOT EXISTS service_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL,
    service_type_id INTEGER,
    service_type_name TEXT NOT NULL,  -- Store name in case type is deleted
    odo_km INTEGER NOT NULL,
    cost INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
    FOREIGN KEY(service_type_id) REFERENCES service_types(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_service_types_vehicle ON service_types(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_readings_vehicle ON odometer_readings(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_services_vehicle ON service_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);

-- Admin: Allowed users (dynamically added via admin panel)
CREATE TABLE IF NOT EXISTS allowed_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL UNIQUE,
    notes TEXT,
    added_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Admin: Access requests (logged when unauthorized users try to access)
CREATE TABLE IF NOT EXISTS access_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    attempt_count INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_allowed_users_telegram ON allowed_users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_telegram ON access_requests(telegram_id);
