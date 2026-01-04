const { Markup } = require('telegraf');
const db = require('../db');

/**
 * Get the main menu keyboard
 */
function getMainMenuKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('🚗 My Vehicles', 'menu_vehicles'),
            Markup.button.callback('📊 Status', 'menu_status')
        ],
        [
            Markup.button.callback('➕ Add Vehicle', 'menu_addvehicle'),
            Markup.button.callback('📝 Log Odometer', 'menu_logodo')
        ],
        [
            Markup.button.callback('🔧 Record Service', 'menu_service'),
            Markup.button.callback('⛽ Log Fuel', 'menu_fuel')
        ],
        [
            Markup.button.callback('📜 History', 'menu_history'),
            Markup.button.callback('⏰ Reminders', 'menu_reminders')
        ],
        [
            Markup.button.callback('⚙️ Settings', 'menu_settings'),
            Markup.button.callback('❓ Help', 'menu_help')
        ]
    ]);
}

/**
 * Show status (reusable for command and menu)
 */
async function showStatus(ctx, isEdit = false) {
    const user = db.getOrCreateUser(
        ctx.from.id.toString(),
        ctx.from.username,
        ctx.from.first_name
    );

    const vehicles = db.getVehiclesByUser(user.id);

    if (vehicles.length === 0) {
        const content = {
            text: '🚗 No vehicles yet!\n\nAdd one to start tracking.',
            options: {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('➕ Add Vehicle', 'menu_addvehicle')],
                    [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                ])
            }
        };
        if (isEdit) {
            await ctx.editMessageText(content.text, content.options);
        } else {
            await ctx.reply(content.text, content.options);
        }
        return;
    }

    let message = `📊 *Vehicle Status*\n\n`;

    for (const vehicle of vehicles) {
        const serviceStatuses = db.getServiceStatusForVehicle(vehicle.id);

        message += `*${vehicle.name}*`;
        if (vehicle.plate) message += ` (${vehicle.plate})`;
        message += '\n';
        message += `📍 ${vehicle.current_odo.toLocaleString()} km\n`;

        if (serviceStatuses.length > 0) {
            for (const st of serviceStatuses) {
                const status = st.status;
                const emoji = status.isOverdue ? '🔴' :
                    ((status.remainingKm !== null && status.remainingKm <= 500) ||
                        (status.remainingDays !== null && status.remainingDays <= 7)) ? '🟡' : '🟢';

                let statusText = '';
                if (status.remainingKm !== null) {
                    const value = status.isOverdue && status.remainingKm <= 0
                        ? `OVERDUE ${Math.abs(status.remainingKm).toLocaleString()} km`
                        : `${status.remainingKm.toLocaleString()} km`;
                    statusText += value;
                }
                if (status.remainingDays !== null) {
                    if (statusText) statusText += ' | ';
                    const value = status.isOverdue && status.remainingDays <= 0
                        ? `OVERDUE ${Math.abs(status.remainingDays)} days`
                        : `${status.remainingDays} days`;
                    statusText += value;
                }

                message += `${emoji} ${st.name}: ${statusText}\n`;
            }
        } else {
            message += `_No services configured - use /addservice_\n`;
        }
        message += '\n';
    }

    const options = {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'back_to_menu')]])
    };

    if (isEdit) {
        await ctx.editMessageText(message, options);
    } else {
        await ctx.reply(message, options);
    }
}

/**
 * Register status and settings command handlers
 */
function registerStatusHandlers(bot) {
    // /start - Welcome message with menu
    bot.start(async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        let welcomeText = `👋 *Welcome to OdoTracker, ${ctx.from.first_name}!*\n\n`;

        if (vehicles.length === 0) {
            welcomeText += `🚀 *Get Started:*\n` +
                `1️⃣ Tap "➕ Add Vehicle" below\n` +
                `2️⃣ Send a 📷 photo of your odometer\n` +
                `3️⃣ I'll remind you when service is due!\n`;
        } else {
            welcomeText += `You have *${vehicles.length} vehicle(s)* being tracked.\n\n` +
                `📷 Send a photo of your odometer anytime to log mileage!`;
        }

        await ctx.reply(welcomeText, {
            parse_mode: 'Markdown',
            ...getMainMenuKeyboard()
        });
    });

    // /menu - Show main menu anytime
    bot.command('menu', async (ctx) => {
        await ctx.reply(
            '📱 *Main Menu*\n\nWhat would you like to do?',
            {
                parse_mode: 'Markdown',
                ...getMainMenuKeyboard()
            }
        );
    });

    // /help - Show all commands
    bot.help(async (ctx) => {
        await ctx.reply(
            `📖 *OdoTracker Commands*\n\n` +
            `*Quick:* /menu - Main menu\n\n` +
            `*Vehicles:*\n` +
            `/addvehicle - Add a new vehicle\n` +
            `/vehicles - List your vehicles\n` +
            `/editvehicle - Edit vehicle details\n` +
            `/removevehicle - Remove a vehicle\n\n` +
            `*Odometer:*\n` +
            `📷 Send a photo - Auto-detect via OCR\n` +
            `/logodo - Manually log reading\n` +
            `/history - View history\n\n` +
            `*Service:*\n` +
            `/service - Record service event\n` +
            `/servicehistory - View history\n\n` +
            `*Fuel:*\n` +
            `/fuel - Log fuel refill\n` +
            `/fuelhistory - Fuel history\n` +
            `/fuelstats - Efficiency by brand\n\n` +
            `*Other:*\n` +
            `/status - Vehicle status\n` +
            `/reminders - View/Add reminders\n` +
            `/reminder - Set daily check time\n` +
            `/settings - Your settings`,
            { parse_mode: 'Markdown' }
        );
    });

    // /status - Show status of all vehicles
    bot.command('status', async (ctx) => {
        await showStatus(ctx, false);
    });

    // Menu button handlers
    bot.action('menu_vehicles', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.editMessageText(
                '🚗 No vehicles yet!\n\nAdd one to get started.',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('➕ Add Vehicle', 'menu_addvehicle')],
                        [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                    ])
                }
            );
            return;
        }

        let message = '🚗 *Your Vehicles*\n\n';

        for (const vehicle of vehicles) {
            const serviceStatuses = db.getServiceStatusForVehicle(vehicle.id);
            const hasOverdue = serviceStatuses.some(s => s.status.isOverdue);
            const hasWarning = serviceStatuses.some(s =>
                (s.status.remainingKm !== null && s.status.remainingKm <= 500) ||
                (s.status.remainingDays !== null && s.status.remainingDays <= 7)
            );
            const statusEmoji = hasOverdue ? '🔴' : hasWarning ? '🟡' : '🟢';

            message += `*${vehicle.name}*`;
            if (vehicle.plate) message += ` (${vehicle.plate})`;
            message += '\n';
            message += `├ 📍 ${vehicle.current_odo.toLocaleString()} km\n`;
            if (serviceStatuses.length > 0) {
                message += `└ ${statusEmoji} ${serviceStatuses.length} service type(s)\n\n`;
            } else {
                message += `└ _No services configured_\n\n`;
            }
        }

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ Add Vehicle', 'menu_addvehicle')],
                [Markup.button.callback('✏️ Edit Vehicles', 'menu_edit_vehicles')],
                [Markup.button.callback('« Back to Menu', 'back_to_menu')]
            ])
        });
    });

    bot.action('menu_status', async (ctx) => {
        await ctx.answerCbQuery();
        await showStatus(ctx, true);
    });

    bot.action('menu_addvehicle', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        ctx.session = ctx.session || {};
        ctx.session.addingVehicle = { step: 'type', userId: user.id };

        await ctx.editMessageText(
            '🚗 *Add New Vehicle*\n\nWhat type of vehicle?',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('🏍️ Motorcycle', 'vehicle_type_motorcycle'),
                        Markup.button.callback('🚗 Car', 'vehicle_type_car')
                    ]
                ])
            }
        );
    });

    bot.action('menu_logodo', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.editMessageText(
                '🚗 You need to add a vehicle first!',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('➕ Add Vehicle', 'menu_addvehicle')],
                        [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                    ])
                }
            );
            return;
        }

        await ctx.editMessageText(
            '📷 *Log Odometer*\n\n' +
            '📸 Just send a photo of your odometer!\n\n' +
            '_Or tap below to enter manually:_',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    ...vehicles.map(v => [
                        Markup.button.callback(`✏️ ${v.name} (${v.current_odo.toLocaleString()} km)`, `logodo_vehicle_${v.id}`)
                    ]),
                    [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                ])
            }
        );
    });

    bot.action('menu_fuel', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.editMessageText(
                '🚗 You need to add a vehicle first!',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('➕ Add Vehicle', 'menu_addvehicle')],
                        [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                    ])
                }
            );
            return;
        }

        const buttons = vehicles.map(v => {
            const icon = v.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
            return [Markup.button.callback(`${icon} ${v.name} (${v.current_odo.toLocaleString()} km)`, `fuel_vehicle_${v.id}`)];
        });
        buttons.push([Markup.button.callback('📊 Fuel Stats', 'menu_fuelstats')]);
        buttons.push([Markup.button.callback('« Back to Menu', 'back_to_menu')]);

        await ctx.editMessageText(
            '⛽ *Log Fuel Refill*\n\nSelect a vehicle:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    bot.action('menu_fuelstats', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);
        const buttons = vehicles.map(v => {
            const icon = v.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
            return [Markup.button.callback(`${icon} ${v.name}`, `fuelstats_${v.id}`)];
        });
        buttons.push([Markup.button.callback('« Back', 'menu_fuel')]);

        await ctx.editMessageText(
            '📊 *Fuel Stats*\n\nSelect a vehicle:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    bot.action('menu_service', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.editMessageText(
                '🚗 You need to add a vehicle first!',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('➕ Add Vehicle', 'menu_addvehicle')],
                        [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                    ])
                }
            );
            return;
        }

        const buttons = vehicles.map(v => {
            const serviceStatuses = db.getServiceStatusForVehicle(v.id);
            const hasOverdue = serviceStatuses.some(s => s.status.isOverdue);
            const hasWarning = serviceStatuses.some(s =>
                (s.status.remainingKm !== null && s.status.remainingKm <= 500) ||
                (s.status.remainingDays !== null && s.status.remainingDays <= 7)
            );
            const emoji = hasOverdue ? '🔴' : hasWarning ? '🟡' : '🟢';
            return [Markup.button.callback(`${emoji} ${v.name}`, `service_vehicle_${v.id}`)];
        });
        buttons.push([Markup.button.callback('« Back to Menu', 'back_to_menu')]);

        await ctx.editMessageText(
            '🔧 *Record Service Event*\n\nSelect a vehicle:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    bot.action('menu_history', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.editMessageText('No vehicles yet. Add one first!', {
                ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'back_to_menu')]])
            });
            return;
        }

        await ctx.editMessageText(
            '📜 *History*\n\nWhat would you like to see?',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📊 Odometer History', 'menu_odo_history')],
                    [Markup.button.callback('🔧 Service History', 'menu_service_history')],
                    [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                ])
            }
        );
    });

    bot.action('menu_odo_history', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);
        const buttons = vehicles.map(v => [
            Markup.button.callback(v.name, `history_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('« Back', 'menu_history')]);

        await ctx.editMessageText(
            '📊 *Odometer History*\n\nSelect a vehicle:',
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
    });

    bot.action('menu_service_history', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);
        const buttons = vehicles.map(v => [
            Markup.button.callback(v.name, `servicehistory_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('« Back', 'menu_history')]);

        await ctx.editMessageText(
            '🔧 *Service History*\n\nSelect a vehicle:',
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
    });

    bot.action('menu_reminder', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        await ctx.editMessageText(
            `⏰ *Daily Reminder Settings*\n\n` +
            `Current time: *${user.reminder_time || '20:00'}*\n` +
            `Status: ${user.reminder_enabled ? '✅ Enabled' : '❌ Disabled'}`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🕐 Set Time', 'reminder_settime')],
                    [Markup.button.callback(
                        user.reminder_enabled ? '🔕 Disable' : '🔔 Enable',
                        user.reminder_enabled ? 'reminder_disable' : 'reminder_enable'
                    )],
                    [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                ])
            }
        );
    });

    bot.action('menu_settings', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        await ctx.editMessageText(
            `⚙️ *Your Settings*\n\n` +
            `*User:* ${user.first_name || user.username || 'Unknown'}\n` +
            `*Telegram ID:* \`${user.telegram_id}\`\n\n` +
            `*Vehicles:* ${vehicles.length}\n` +
            `*Reminder:* ${user.reminder_time || '20:00'} (${user.reminder_enabled ? 'On' : 'Off'})\n` +
            `*Timezone:* ${user.timezone || 'Asia/Jakarta'}`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✏️ Edit Vehicles', 'menu_edit_vehicles')],
                    [Markup.button.callback('⏰ Reminders', 'menu_reminders')],
                    [Markup.button.callback('🌍 Set Timezone', 'settings_timezone')],
                    [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                ])
            }
        );
    });

    bot.action('menu_edit_vehicles', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.editMessageText('No vehicles to edit.', {
                ...Markup.inlineKeyboard([[Markup.button.callback('« Back', 'menu_settings')]])
            });
            return;
        }

        const buttons = vehicles.map(v => [
            Markup.button.callback(`✏️ ${v.name}`, `edit_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('🗑️ Remove Vehicle', 'menu_remove_vehicle')]);
        buttons.push([Markup.button.callback('« Back', 'menu_settings')]);

        await ctx.editMessageText(
            '✏️ *Edit Vehicles*\n\nSelect a vehicle to edit:',
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
    });

    bot.action('menu_remove_vehicle', async (ctx) => {
        await ctx.answerCbQuery();
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);
        const buttons = vehicles.map(v => [
            Markup.button.callback(`🗑️ ${v.name}`, `remove_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('« Back', 'menu_edit_vehicles')]);

        await ctx.editMessageText(
            '🗑️ *Remove Vehicle*\n\nSelect a vehicle to remove:',
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
    });

    bot.action('menu_help', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `📖 *OdoTracker Help*\n\n` +
            `*📷 Photo:* Send a photo of your odometer - I'll read it automatically!\n\n` +
            `*Commands:*\n` +
            `/menu - Main menu\n` +
            `/status - Vehicle status\n` +
            `/vehicles - List vehicles\n` +
            `/addvehicle - Add vehicle\n` +
            `/logodo - Log odometer\n` +
            `/service - Record service\n` +
            `/fuel - Log fuel refill\n` +
            `/fuelstats - Fuel efficiency\n` +
            `/history - Odometer history\n` +
            `/servicehistory - Service history\n` +
            `/reminders - Manage reminders\n` +
            `/reminder - Set daily check time\n` +
            `/settings - Your settings`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'back_to_menu')]])
            }
        );
    });

    // Back to menu button
    bot.action('back_to_menu', async (ctx) => {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            '📱 *Main Menu*\n\nWhat would you like to do?',
            {
                parse_mode: 'Markdown',
                ...getMainMenuKeyboard()
            }
        );
    });

    // /reminder - Set reminder time
    bot.command('reminder', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        await ctx.reply(
            `⏰ *Daily Reminder Settings*\n\n` +
            `Current reminder: *${user.reminder_time || '20:00'}*\n` +
            `Status: ${user.reminder_enabled ? '✅ Enabled' : '❌ Disabled'}\n\n` +
            `What would you like to do?`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🕐 Set Time', 'reminder_settime')],
                    [Markup.button.callback(
                        user.reminder_enabled ? '🔕 Disable' : '🔔 Enable',
                        user.reminder_enabled ? 'reminder_disable' : 'reminder_enable'
                    )],
                    [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                ])
            }
        );
    });

    // Set reminder time
    bot.action('reminder_settime', async (ctx) => {
        ctx.session = ctx.session || {};
        ctx.session.settingReminder = true;

        await ctx.editMessageText(
            `⏰ *Set Reminder Time*\n\n` +
            `Enter the time in 24-hour format (HH:MM):\n\n` +
            `_Examples: 08:00, 20:00, 18:30_`,
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCbQuery();
    });

    // Enable reminder
    bot.action('reminder_enable', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        db.updateUserReminder(user.id, user.reminder_time, true);

        await ctx.editMessageText(
            `✅ Daily reminder *enabled*!\n\nYou'll be reminded at ${user.reminder_time} to log your odometer.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'back_to_menu')]])
            }
        );
        await ctx.answerCbQuery('Enabled!');
    });

    // Disable reminder
    bot.action('reminder_disable', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        db.updateUserReminder(user.id, user.reminder_time, false);

        await ctx.editMessageText(
            `🔕 Daily reminder *disabled*.\n\nUse /reminder to enable it again.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'back_to_menu')]])
            }
        );
        await ctx.answerCbQuery('Disabled!');
    });

    // Timezone selection
    bot.action('settings_timezone', async (ctx) => {
        await ctx.answerCbQuery();

        const commonTimezones = [
            { label: '🇮🇩 Jakarta (WIB)', value: 'Asia/Jakarta' },
            { label: '🇮🇩 Makassar (WITA)', value: 'Asia/Makassar' },
            { label: '🇮🇩 Jayapura (WIT)', value: 'Asia/Jayapura' },
            { label: '🇸🇬 Singapore', value: 'Asia/Singapore' },
            { label: '🇲🇾 Kuala Lumpur', value: 'Asia/Kuala_Lumpur' },
            { label: '🇹🇭 Bangkok', value: 'Asia/Bangkok' },
            { label: '🇯🇵 Tokyo', value: 'Asia/Tokyo' },
            { label: '🇦🇺 Sydney', value: 'Australia/Sydney' },
            { label: '🇬🇧 London', value: 'Europe/London' },
            { label: '🇺🇸 New York', value: 'America/New_York' },
        ];

        const buttons = commonTimezones.map(tz => [
            Markup.button.callback(tz.label, `set_tz_${tz.value}`)
        ]);
        buttons.push([Markup.button.callback('✏️ Enter Custom', 'tz_custom')]);
        buttons.push([Markup.button.callback('« Back to Settings', 'menu_settings')]);

        await ctx.editMessageText(
            `🌍 *Set Your Timezone*\n\n` +
            `Select your timezone for accurate reminders:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    // Handle timezone selection
    bot.action(/^set_tz_(.+)$/, async (ctx) => {
        const timezone = ctx.match[1];
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        db.updateUserTimezone(user.id, timezone);

        await ctx.editMessageText(
            `✅ Timezone set to *${timezone}*!\n\n` +
            `Your reminders will now be based on this timezone.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Settings', 'menu_settings')]])
            }
        );
        await ctx.answerCbQuery('Timezone updated!');
    });

    // Custom timezone input
    bot.action('tz_custom', async (ctx) => {
        ctx.session = ctx.session || {};
        ctx.session.settingTimezone = true;

        await ctx.editMessageText(
            `🌍 *Enter Custom Timezone*\n\n` +
            `Enter a valid IANA timezone name:\n\n` +
            `_Examples: Asia/Jakarta, America/Los_Angeles, Europe/Paris_\n\n` +
            `📋 [Full list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)`,
            { parse_mode: 'Markdown', disable_web_page_preview: true }
        );
        await ctx.answerCbQuery();
    });

    // /settings - View settings
    bot.command('settings', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        await ctx.reply(
            `⚙️ *Your Settings*\n\n` +
            `*User:* ${user.first_name || user.username || 'Unknown'}\n` +
            `*Telegram ID:* \`${user.telegram_id}\`\n\n` +
            `*Daily Reminder:*\n` +
            `├ Time: ${user.reminder_time || '20:00'}\n` +
            `└ Status: ${user.reminder_enabled ? '✅ Enabled' : '❌ Disabled'}\n\n` +
            `*Timezone:* ${user.timezone || 'Asia/Jakarta'}\n\n` +
            `*Vehicles:* ${vehicles.length}`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✏️ Edit Vehicles', 'menu_edit_vehicles')],
                    [Markup.button.callback('⏰ Reminders', 'menu_reminders')],
                    [Markup.button.callback('🌍 Set Timezone', 'settings_timezone')],
                    [Markup.button.callback('« Back to Menu', 'back_to_menu')]
                ])
            }
        );
    });
}

/**
 * Handle text input for status/settings
 */
function handleStatusTextInput(ctx, session) {
    if (session.settingReminder) {
        return handleReminderTimeInput(ctx, session);
    }
    if (session.settingTimezone) {
        return handleTimezoneInput(ctx, session);
    }
    return false;
}

async function handleReminderTimeInput(ctx, session) {
    const text = ctx.message.text.trim();

    // Validate time format
    const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
        await ctx.reply('Please enter time in HH:MM format (e.g., 20:00)');
        return true;
    }

    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        await ctx.reply('Invalid time. Hours should be 0-23, minutes 0-59.');
        return true;
    }

    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

    const user = db.getOrCreateUser(
        ctx.from.id.toString(),
        ctx.from.username,
        ctx.from.first_name
    );

    db.updateUserReminder(user.id, timeStr, true);
    delete session.settingReminder;

    await ctx.reply(
        `✅ Reminder time set to *${timeStr}*!\n\nYou'll be reminded daily to log your odometer.`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Menu', 'back_to_menu')]])
        }
    );
    return true;
}

async function handleTimezoneInput(ctx, session) {
    const timezone = ctx.message.text.trim();

    // Validate timezone by trying to format a date with it
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    } catch (e) {
        await ctx.reply(
            `❌ Invalid timezone: "${timezone}"\n\n` +
            `Please enter a valid IANA timezone name like:\n` +
            `• Asia/Jakarta\n• America/New_York\n• Europe/London`,
            { parse_mode: 'Markdown' }
        );
        return true;
    }

    const user = db.getOrCreateUser(
        ctx.from.id.toString(),
        ctx.from.username,
        ctx.from.first_name
    );

    db.updateUserTimezone(user.id, timezone);
    delete session.settingTimezone;

    await ctx.reply(
        `✅ Timezone set to *${timezone}*!\n\nYour reminders will now be based on this timezone.`,
        {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('« Back to Settings', 'menu_settings')]])
        }
    );
    return true;
}

module.exports = {
    registerStatusHandlers,
    handleStatusTextInput,
    getMainMenuKeyboard
};
