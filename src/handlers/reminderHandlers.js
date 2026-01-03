const { Markup } = require('telegraf');
const db = require('../db');

/**
 * Register reminder-related command handlers
 */
function registerReminderHandlers(bot) {
    // /reminders - List active reminders
    bot.command('reminders', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        await showReminders(ctx, user.id);
    });

    // /addreminder - Add a new reminder
    bot.command('addreminder', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);
        if (vehicles.length === 0) {
            return ctx.reply('Please add a vehicle first using /addvehicle');
        }

        // If user has only one vehicle, select it automatically
        if (vehicles.length === 1) {
            startAddingReminder(ctx, user.id, vehicles[0].id);
        } else {
            // Ask user to select a vehicle
            const buttons = vehicles.map(v => [
                Markup.button.callback(v.name, `addreminder_vehicle_${v.id}`)
            ]);

            await ctx.reply(
                '🚗 Select a vehicle to add a reminder for:',
                Markup.inlineKeyboard(buttons)
            );
        }
    });

    // Handle vehicle selection for adding reminder
    bot.action(/^addreminder_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        await ctx.answerCbQuery();

        // Setup session
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        startAddingReminder(ctx, user.id, vehicleId);
    });

    // Handle text input for adding reminder steps
    bot.on('text', async (ctx, next) => {
        if (!ctx.session?.addingReminder) return next();

        const handled = await handleReminderTextInput(ctx, ctx.session);
        if (!handled) return next();
    });

    // Menu callback for reminders
    bot.action('menu_reminders', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );
        await showReminders(ctx, user.id);
    });

    // Handle "Add Reminder" button from reminders menu
    bot.action('add_reminder_menu', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);
        if (vehicles.length === 0) {
            return ctx.reply('Please add a vehicle first using /addvehicle');
        }

        if (vehicles.length === 1) {
            startAddingReminder(ctx, user.id, vehicles[0].id);
        } else {
            const buttons = vehicles.map(v => [
                Markup.button.callback(v.name, `addreminder_vehicle_${v.id}`)
            ]);
            buttons.push([Markup.button.callback('« Back', 'menu_reminders')]);

            await ctx.editMessageText(
                '🚗 Select a vehicle to add a reminder for:',
                { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
            );
        }
    });

    // /removereminder - Remove a reminder
    bot.command('removereminder', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );
        startRemovingReminderFlow(ctx, user.id);
    });

    // Handle "Remove Reminder" button
    bot.action('remove_reminder_menu', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );
        startRemovingReminderFlow(ctx, user.id);
    });

    // Handle vehicle selection for removing reminder
    bot.action(/^remove_reminder_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        await ctx.answerCbQuery();
        listRemindersForRemoval(ctx, vehicleId);
    });

    // Handle reminder selection for deletion
    bot.action(/^delete_reminder_conf_(\d+)$/, async (ctx) => {
        const serviceTypeId = parseInt(ctx.match[1]);
        await ctx.answerCbQuery();

        const serviceType = db.getServiceTypeById(serviceTypeId);
        if (!serviceType) {
            return ctx.editMessageText('Reminder not found or already deleted.');
        }

        await ctx.editMessageText(
            `⚠️ *Delete Reminder?*\n\n` +
            `Are you sure you want to delete *${serviceType.name}*?`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Yes, Delete', `delete_reminder_exec_${serviceTypeId}`)],
                    [Markup.button.callback('❌ Cancel', 'menu_reminders')]
                ])
            }
        );
    });

    // Execute deletion
    bot.action(/^delete_reminder_exec_(\d+)$/, async (ctx) => {
        const serviceTypeId = parseInt(ctx.match[1]);
        const serviceType = db.getServiceTypeById(serviceTypeId);

        if (serviceType) {
            db.deleteServiceType(serviceTypeId);
            await ctx.answerCbQuery('Reminder deleted');
            await ctx.editMessageText(
                `✅ *${serviceType.name}* has been removed.`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('« Back to Reminders', 'menu_reminders')]
                    ])
                }
            );
        } else {
            await ctx.answerCbQuery('Reminder not found');
            await ctx.editMessageText('Reminder not found.');
        }
    });
}

function startAddingReminder(ctx, userId, vehicleId) {
    ctx.session = ctx.session || {};
    ctx.session.addingReminder = { step: 'name', userId, vehicleId };

    ctx.reply(
        '⏰ *Add New Reminder*\n\n' +
        'What do you want to be reminded about?\n' +
        '_Example: Check Tire Pressure, renew Insurance, etc._',
        { parse_mode: 'Markdown' }
    );
}

async function handleReminderTextInput(ctx, session) {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return false; // Don't handle commands

    const { step, vehicleId } = session.addingReminder;
    const vehicle = db.getVehicleById(vehicleId);

    switch (step) {
        case 'name':
            session.addingReminder.name = text;
            session.addingReminder.step = 'interval';

            await ctx.reply(
                `*${text}* - got it!\n\n` +
                `How often should I verify this?\n` +
                `_Examples: "2 weeks", "3 months", "1 year", "30 days"_`,
                { parse_mode: 'Markdown' }
            );
            return true;

        case 'interval':
            const days = parseIntervalToDays(text);
            if (!days) {
                await ctx.reply(
                    '❌ Could not understand that interval.\n' +
                    'Please try something like: "2 weeks", "1 month", "30 days"'
                );
                return true;
            }

            // Create the reminder (service type with only days)
            db.addServiceType(vehicleId, session.addingReminder.name, null, days);

            await ctx.reply(
                `✅ *Reminder Set!*\n\n` +
                `🚗 ${vehicle.name}\n` +
                `⏰ *${session.addingReminder.name}*\n` +
                `📅 Every ${formatDays(days)}\n\n` +
                `_I'll notify you when it's due! Use /reminders to view._`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('⏰ View Reminders', 'menu_reminders')]
                    ])
                }
            );

            delete session.addingReminder;
            return true;
    }
    return false;
}

async function showReminders(ctx, userId) {
    const vehicles = db.getVehiclesByUser(userId);
    if (vehicles.length === 0) {
        return ctx.reply('No vehicles found. Add one with /addvehicle first.');
    }

    let message = '⏰ *Your Reminders*\n\n';
    let hasReminders = false;

    for (const vehicle of vehicles) {
        const statusList = db.getServiceStatusForVehicle(vehicle.id);
        // Filter for time-based reminders (where type is 'time' or 'both')
        const reminders = statusList.filter(s => s.status.type === 'time' || s.status.type === 'both');

        if (reminders.length > 0) {
            hasReminders = true;
            message += `🚗 *${vehicle.name}*\n`;

            for (const r of reminders) {
                const status = r.status;
                const emoji = status.isOverdue ? '🔴' : (status.remainingDays <= 7 ? '🟡' : '🟢');

                let dueText = '';
                if (status.isOverdue) {
                    dueText = `*OVERDUE by ${Math.abs(status.remainingDays)} days*`;
                } else {
                    dueText = `Due in ${status.remainingDays} days`;
                }

                message += `${emoji} ${r.name}: ${dueText}\n`;
            }
            message += '\n';
        }
    }

    if (!hasReminders) {
        message += '_No active time-based reminders._\nUse /addreminder to create one.';
    }

    const buttons = [
        [Markup.button.callback('➕ Add Reminder', 'add_reminder_menu')],
        [Markup.button.callback('🗑️ Remove Reminder', 'remove_reminder_menu')],
        [Markup.button.callback('« Back to Menu', 'back_to_menu')]
    ];

    // If called from a command (no edit capability usually, but we can try) or callback
    try {
        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        } else {
            await ctx.reply(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            });
        }
    } catch (e) {
        // Fallback for older messages
        await ctx.reply(message, { parse_mode: 'Markdown' });
    }
}

// Helper to parse "2 weeks" etc
function parseIntervalToDays(text) {
    const match = text.toLowerCase().match(/(\d+)\s*(day|week|month|year)s?/);
    if (!match) return null;

    const num = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case 'day': return num;
        case 'week': return num * 7;
        case 'month': return num * 30; // Approx
        case 'year': return num * 365;
        default: return null;
    }
}

function formatDays(days) {
    if (days % 365 === 0) return `${days / 365} year(s)`;
    if (days % 30 === 0) return `${days / 30} month(s)`;
    if (days % 7 === 0) return `${days / 7} week(s)`;
    return `${days} day(s)`;
}

// Helper to start removal flow
async function startRemovingReminderFlow(ctx, userId) {
    const vehicles = db.getVehiclesByUser(userId);
    if (vehicles.length === 0) {
        return ctx.reply('No vehicles found.');
    }

    if (vehicles.length === 1) {
        listRemindersForRemoval(ctx, vehicles[0].id);
    } else {
        const buttons = vehicles.map(v => [
            Markup.button.callback(v.name, `remove_reminder_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('« Back', 'menu_reminders')]);

        const message = '🗑️ Select a vehicle to remove reminders from:';
        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        } else {
            await ctx.reply(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        }
    }
}

async function listRemindersForRemoval(ctx, vehicleId) {
    const serviceStatuses = db.getServiceStatusForVehicle(vehicleId);
    // Filter time-based reminders
    const reminders = serviceStatuses.filter(s => s.status.type === 'time' || s.status.type === 'both');

    if (reminders.length === 0) {
        const message = 'No time-based reminders found for this vehicle.';
        const buttons = [[Markup.button.callback('« Back', 'menu_reminders')]];
        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, { ...Markup.inlineKeyboard(buttons) });
        } else {
            await ctx.reply(message, { ...Markup.inlineKeyboard(buttons) });
        }
        return;
    }

    const buttons = reminders.map(r => [
        Markup.button.callback(`🗑️ ${r.name}`, `delete_reminder_conf_${r.id}`)
    ]);
    buttons.push([Markup.button.callback('« Back', 'menu_reminders')]);

    const message = '🗑️ *Remove Reminder*\n\nSelect a reminder to delete:';
    if (ctx.callbackQuery) {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } else {
        await ctx.reply(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }
}

module.exports = {
    registerReminderHandlers
};
