require('dotenv').config();

const { Telegraf, session } = require('telegraf');
const db = require('./db');
const sheets = require('./sheets');
const scheduler = require('./scheduler');

// Import handlers
const { registerVehicleHandlers, handleVehicleTextInput } = require('./handlers/vehicleHandlers');
const { registerOdometerHandlers, handleOdometerTextInput } = require('./handlers/odometerHandlers');
const { registerServiceHandlers, handleServiceTextInput } = require('./handlers/serviceHandlers');
const { registerStatusHandlers, handleStatusTextInput } = require('./handlers/statusHandlers');
const { registerReminderHandlers } = require('./handlers/reminderHandlers');

// Validate environment
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is required in .env file');
    process.exit(1);
}

// Initialize bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Use session middleware
bot.use(session());

// Ensure session exists
bot.use((ctx, next) => {
    ctx.session = ctx.session || {};
    return next();
});

// Optional: Restrict to allowed users (family members)
if (process.env.ALLOWED_USER_IDS) {
    const allowedIds = process.env.ALLOWED_USER_IDS.split(',').map(id => id.trim());

    bot.use((ctx, next) => {
        const userId = ctx.from?.id?.toString();
        if (userId && !allowedIds.includes(userId)) {
            console.log(`⛔ Unauthorized access attempt from ${userId}`);
            return ctx.reply('Sorry, this bot is private. Contact the owner for access.');
        }
        return next();
    });

    console.log(`🔒 Bot restricted to ${allowedIds.length} user(s)`);
}

// Register all command handlers
registerStatusHandlers(bot);
registerVehicleHandlers(bot);
registerOdometerHandlers(bot);
registerServiceHandlers(bot);
registerReminderHandlers(bot);

// Handle text messages (for multi-step inputs)
bot.on('text', async (ctx) => {
    // Skip if it's a command
    if (ctx.message.text.startsWith('/')) {
        // Handle /skip and /current commands in context
        if (ctx.message.text.toLowerCase() === '/skip' || ctx.message.text.toLowerCase() === '/current') {
            // These are handled by the session-based handlers
        } else {
            return; // Let command handlers deal with it
        }
    }

    const session = ctx.session || {};

    // Try each handler in order
    if (await handleVehicleTextInput(ctx, session)) return;
    if (await handleOdometerTextInput(ctx, session)) return;
    if (await handleServiceTextInput(ctx, session)) return;
    if (await handleStatusTextInput(ctx, session)) return;

    // If nothing handled it and it's not a command, show help hint
    if (!ctx.message.text.startsWith('/')) {
        await ctx.reply(
            '💡 *Tip:* Send a photo of your odometer to log mileage, or use /help to see commands.',
            { parse_mode: 'Markdown' }
        );
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`❌ Error for ${ctx.updateType}:`, err);
    ctx.reply('Oops! Something went wrong. Please try again.').catch(() => { });
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down...`);
    scheduler.stopScheduler();
    bot.stop(signal);
    process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start the bot
async function main() {
    console.log('🚀 Starting OdoTracker Bot...\n');

    // Initialize database
    db.initDb();

    // Initialize Google Sheets (optional)
    await sheets.initSheets();

    // Initialize scheduler
    scheduler.initScheduler(bot);

    // Set bot commands (creates the Menu button)
    await bot.telegram.setMyCommands([
        { command: 'start', description: '🏠 Main menu' },
        { command: 'vehicles', description: '🚗 View my vehicles' },
        { command: 'addvehicle', description: '➕ Add a vehicle' },
        { command: 'removevehicle', description: '🗑️ Remove a vehicle' },
        { command: 'addservice', description: '🔧 Add service type' },
        { command: 'service', description: '📝 Record a service' },
        { command: 'service', description: '📝 Record a service' },
        { command: 'logodo', description: '📍 Log odometer manually' },
        { command: 'reminders', description: '⏰ View reminders' },
        { command: 'addreminder', description: '➕ Add reminder' },
        { command: 'status', description: '📊 Vehicle status' },
        { command: 'history', description: '📜 Odometer history' },
        { command: 'servicehistory', description: '🔧 Service history' },
        { command: 'settings', description: '⚙️ My settings' },
        { command: 'help', description: '❓ Help & commands' }
    ]);
    console.log('✅ Bot commands set');

    // Start bot
    await bot.launch();

    console.log('\n✅ OdoTracker Bot is running!');
    console.log('📱 Open Telegram and search for your bot to start using it.\n');
}

main().catch(err => {
    console.error('Failed to start bot:', err);
    process.exit(1);
});
