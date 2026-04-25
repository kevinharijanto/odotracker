const db = require('./db');

let bot = null;
let checkInterval = null;

/**
 * Initialize the scheduler with the bot instance
 */
function initScheduler(botInstance) {
    bot = botInstance;

    // Check every minute for reminders
    checkInterval = setInterval(checkReminders, 60 * 1000);

    console.log('✅ Scheduler initialized');
}

/**
 * Stop the scheduler
 */
function stopScheduler() {
    if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
    }
}

/**
 * Check if any users need to be reminded
 */
async function checkReminders() {
    const users = db.getUsersWithReminders();

    for (const user of users) {
        // Get current time in user's timezone
        const userTimezone = user.timezone || 'Asia/Jakarta';
        const currentTime = getCurrentTimeInTimezone(userTimezone);

        if (user.reminder_time === currentTime) {
            await sendDailyReminder(user);
        }
    }

    // Also check for BP stock notifications
    await checkBpStockUpdates();
}

/**
 * Get current time (HH:MM) in a specific timezone
 */
function getCurrentTimeInTimezone(timezone) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        return formatter.format(now);
    } catch (e) {
        // Fallback to UTC if invalid timezone
        console.error(`Invalid timezone: ${timezone}, falling back to UTC`);
        const now = new Date();
        return `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}`;
    }
}

/**
 * Send daily reminder to a user
 */
async function sendDailyReminder(user) {
    if (!bot) return;

    try {
        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) return;

        let message = `📸 *Daily Odometer Reminder*\n\n`;
        message += `Hey ${user.first_name || 'there'}! Time to log your odometer.\n\n`;

        for (const vehicle of vehicles) {
            const serviceStatuses = db.getServiceStatusForVehicle(vehicle.id);

            if (serviceStatuses.length === 0) {
                message += `🚗 *${vehicle.name}* - ${vehicle.current_odo.toLocaleString()} km\n`;
                continue;
            }

            // Check for overdue or warning services
            const overdue = serviceStatuses.filter(s => s.status.isOverdue);
            const warning = serviceStatuses.filter(s => !s.status.isOverdue && (
                (s.status.remainingKm !== null && s.status.remainingKm <= 500) ||
                (s.status.remainingDays !== null && s.status.remainingDays <= 7)
            ));

            if (overdue.length > 0) {
                message += `🔴 *${vehicle.name}* - ${overdue.length} service(s) OVERDUE!\n`;
                for (const s of overdue) {
                    const status = s.status;
                    let dueText = '';
                    if (status.remainingKm !== null && status.remainingKm <= 0) dueText = `${Math.abs(status.remainingKm).toLocaleString()} km`;
                    if (status.remainingDays !== null && status.remainingDays <= 0) {
                        if (dueText) dueText += ' / ';
                        dueText += `${Math.abs(status.remainingDays)} days`;
                    }
                    message += `   • ${s.name}: ${dueText} over\n`;
                }
            } else if (warning.length > 0) {
                message += `🟡 *${vehicle.name}* - ${warning.length} service(s) due soon\n`;
            } else {
                message += `🟢 *${vehicle.name}* - All services OK\n`;
            }
        }

        message += `\n📷 Send a photo of your odometer to update!`;

        await bot.telegram.sendMessage(user.telegram_id, message, {
            parse_mode: 'Markdown'
        });

        console.log(`📨 Reminder sent to ${user.first_name || user.telegram_id}`);
    } catch (error) {
        console.error(`Failed to send reminder to ${user.telegram_id}:`, error.message);
    }
}

/**
 * Check if any services need attention and send alerts
 * Call this after logging odometer readings
 */
async function checkServiceAlerts(userId, vehicleId) {
    if (!bot) return;

    const user = db.getUserById(userId);
    const vehicle = db.getVehicleById(vehicleId);

    if (!user || !vehicle) return;

    const serviceStatuses = db.getServiceStatusForVehicle(vehicleId);

    // Check for any overdue services
    const overdue = serviceStatuses.filter(s => s.status.isOverdue);
    const almostDue = serviceStatuses.filter(s => !s.status.isOverdue && (
        (s.status.remainingKm !== null && s.status.remainingKm <= 100) ||
        (s.status.remainingDays !== null && s.status.remainingDays <= 3)
    ));

    if (overdue.length > 0) {
        let message = `🚨 *SERVICE OVERDUE!*\n\n*${vehicle.name}*:\n`;
        for (const s of overdue) {
            const status = s.status;
            let dueText = '';
            if (status.remainingKm !== null && status.remainingKm <= 0) dueText = `${Math.abs(status.remainingKm).toLocaleString()} km`;
            if (status.remainingDays !== null && status.remainingDays <= 0) {
                if (dueText) dueText += ' / ';
                dueText += `${Math.abs(status.remainingDays)} days`;
            }
            message += `• ${s.name}: ${dueText} past due\n`;
        }
        message += `\nPlease schedule service soon!`;

        await bot.telegram.sendMessage(user.telegram_id, message, {
            parse_mode: 'Markdown'
        });
    } else if (almostDue.length > 0) {
        let message = `⚠️ *Service Almost Due!*\n\n*${vehicle.name}*:\n`;
        for (const s of almostDue) {
            const status = s.status;
            let dueText = '';
            if (status.remainingKm !== null) dueText = `${status.remainingKm.toLocaleString()} km`;
            if (status.remainingDays !== null) {
                if (dueText) dueText += ' / ';
                dueText += `${status.remainingDays} days`;
            }
            message += `• ${s.name}: ${dueText} left\n`;
        }

        await bot.telegram.sendMessage(user.telegram_id, message, {
            parse_mode: 'Markdown'
        });
    }
}

/**
 * Check and send BP stock updates for subscribed users
 */
async function checkBpStockUpdates() {
    if (!bot) return;

    const users = db.getUsersWithBpStockNotify();
    if (users.length === 0) return;

    // Check if current time is 08:00 for at least one user before scraping
    let shouldScrape = false;
    const usersToNotify = [];

    for (const user of users) {
        const userTimezone = user.timezone || 'Asia/Jakarta';
        const currentTime = getCurrentTimeInTimezone(userTimezone);

        if (currentTime === '08:00') {
            shouldScrape = true;
            usersToNotify.push(user);
        }
    }

    if (!shouldScrape) return;

    try {
        const { scrapeBPStockJGC, formatBPStockMessage } = require('./bpStockScraper');
        const data = await scrapeBPStockJGC();
        const message = formatBPStockMessage(data);

        for (const user of usersToNotify) {
            try {
                await bot.telegram.sendMessage(user.telegram_id, message, {
                    parse_mode: 'Markdown'
                });
                console.log(`📨 BP Stock update sent to ${user.first_name || user.telegram_id}`);
            } catch (userErr) {
                console.error(`Failed to send BP Stock to ${user.telegram_id}:`, userErr.message);
            }
        }
    } catch (error) {
        console.error('Failed to run scheduled BP stock update:', error.message);
    }
}

module.exports = {
    initScheduler,
    stopScheduler,
    checkReminders,
    sendDailyReminder,
    checkServiceAlerts
};
