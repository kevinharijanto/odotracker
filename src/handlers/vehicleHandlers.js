const { Markup } = require('telegraf');
const db = require('../db');
const sheets = require('../sheets');

/**
 * Register vehicle-related command handlers
 */
function registerVehicleHandlers(bot) {
    // /addvehicle - Start adding a new vehicle
    bot.command('addvehicle', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        ctx.session = ctx.session || {};
        ctx.session.addingVehicle = { step: 'type', userId: user.id };

        await ctx.reply(
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

    // Handle vehicle type selection
    bot.action(/^vehicle_type_(car|motorcycle)$/, async (ctx) => {
        const vehicleType = ctx.match[1];

        if (!ctx.session?.addingVehicle) {
            await ctx.answerCbQuery('Session expired. Use /addvehicle again.');
            return;
        }

        ctx.session.addingVehicle.vehicleType = vehicleType;
        ctx.session.addingVehicle.step = 'name';

        const emoji = vehicleType === 'motorcycle' ? '🏍️' : '🚗';
        await ctx.editMessageText(
            `${emoji} *Adding a ${vehicleType}*\n\nWhat's the name of your vehicle?\n\n_Example: Honda Beat 2023, Toyota Avanza, etc._`,
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCbQuery();
    });

    // /vehicles - List all vehicles
    bot.command('vehicles', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.reply(
                '🚗 You don\'t have any vehicles yet.\n\nUse /addvehicle to add your first vehicle!',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        let message = '🚗 *Your Vehicles*\n\n';

        for (const vehicle of vehicles) {
            const serviceStatuses = db.getServiceStatusForVehicle(vehicle.id);

            message += `*${vehicle.name}*`;
            if (vehicle.plate) message += ` (${vehicle.plate})`;
            message += '\n';
            message += `📍 Current: ${vehicle.current_odo.toLocaleString()} km\n`;

            if (serviceStatuses.length > 0) {
                for (const st of serviceStatuses) {
                    const emoji = st.status.isOverdue ? '🔴' : st.status.remaining <= 500 ? '🟡' : '🟢';
                    message += `${emoji} ${st.name}: ${st.status.remaining.toLocaleString()} km\n`;
                }
            } else {
                message += `_No service types configured_\n`;
            }
            message += '\n';
        }

        message += '_Use /addservice to add service types_';

        await ctx.reply(message, { parse_mode: 'Markdown' });
    });

    // /addservice - Add a service type to a vehicle
    bot.command('addservice', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.reply('You need to add a vehicle first! Use /addvehicle');
            return;
        }

        const buttons = vehicles.map(v => [
            Markup.button.callback(`🚗 ${v.name}`, `addservice_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_action')]);

        await ctx.reply(
            '🔧 *Add Service Type*\n\nSelect a vehicle to add a service type:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    // Handle vehicle selection for adding service type
    bot.action(/^addservice_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (!vehicle) {
            await ctx.answerCbQuery('Vehicle not found');
            return;
        }

        ctx.session = ctx.session || {};
        ctx.session.addingServiceType = {
            step: 'name',
            vehicleId,
            vehicleName: vehicle.name
        };

        await ctx.editMessageText(
            `🔧 *Add Service Type for ${vehicle.name}*\n\n` +
            `What type of service do you want to track?\n\n` +
            `_Examples: Oil Change, Tire Rotation, Full Service, Brake Pads, etc._`,
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCbQuery();
    });

    // /removevehicle - Remove a vehicle
    bot.command('removevehicle', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.reply('You don\'t have any vehicles to remove.');
            return;
        }

        const buttons = vehicles.map(v => [
            Markup.button.callback(`🗑️ ${v.name}`, `remove_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_action')]);

        await ctx.reply(
            '🗑️ *Remove Vehicle*\n\nSelect a vehicle to remove:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    // Handle vehicle removal confirmation
    bot.action(/^remove_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (!vehicle) {
            await ctx.answerCbQuery('Vehicle not found');
            return;
        }

        await ctx.editMessageText(
            `⚠️ *Are you sure?*\n\nThis will permanently delete *${vehicle.name}* and all its records.`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Yes, delete', `confirm_remove_${vehicleId}`)],
                    [Markup.button.callback('❌ Cancel', 'cancel_action')]
                ])
            }
        );
        await ctx.answerCbQuery();
    });

    // Confirm vehicle removal
    bot.action(/^confirm_remove_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (vehicle) {
            db.deleteVehicle(vehicleId);
            await ctx.editMessageText(`✅ *${vehicle.name}* has been removed.`, {
                parse_mode: 'Markdown'
            });
        } else {
            await ctx.editMessageText('Vehicle not found.');
        }
        await ctx.answerCbQuery();
    });

    // /editvehicle - Edit vehicle details
    bot.command('editvehicle', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.reply('You don\'t have any vehicles to edit.');
            return;
        }

        const buttons = vehicles.map(v => [
            Markup.button.callback(`✏️ ${v.name}`, `edit_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_action')]);

        await ctx.reply(
            '✏️ *Edit Vehicle*\n\nSelect a vehicle to edit:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    // Handle vehicle edit selection
    bot.action(/^edit_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (!vehicle) {
            await ctx.answerCbQuery('Vehicle not found');
            return;
        }

        await ctx.editMessageText(
            `✏️ *Editing: ${vehicle.name}*\n\nWhat would you like to do?`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📝 Rename', `edit_field_${vehicleId}_name`)],
                    [Markup.button.callback('🔖 Change Plate', `edit_field_${vehicleId}_plate`)],
                    [Markup.button.callback('🔧 Manage Services', `manage_services_${vehicleId}`)],
                    [Markup.button.callback('❌ Cancel', 'cancel_action')]
                ])
            }
        );
        await ctx.answerCbQuery();
    });

    // Manage service types for a vehicle
    bot.action(/^manage_services_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (!vehicle) {
            await ctx.answerCbQuery('Vehicle not found');
            return;
        }

        const serviceTypes = db.getServiceTypesByVehicle(vehicleId);

        let message = `🔧 *Service Types for ${vehicle.name}*\n\n`;

        if (serviceTypes.length === 0) {
            message += '_No service types configured yet._\n';
        } else {
            for (const st of serviceTypes) {
                const status = db.getServiceStatus(st, vehicle.current_odo);
                const emoji = status.isOverdue ? '🔴' :
                    ((status.remainingKm !== null && status.remainingKm <= 500) ||
                        (status.remainingDays !== null && status.remainingDays <= 7)) ? '🟡' : '🟢';

                let intervalText = '';
                if (st.interval_km) intervalText = `${st.interval_km.toLocaleString()} km`;
                if (st.interval_days) intervalText += (intervalText ? ' / ' : '') + `${st.interval_days} days`;

                let remainingText = '';
                if (status.remainingKm !== null) remainingText = `${status.remainingKm.toLocaleString()} km`;
                if (status.remainingDays !== null) remainingText += (remainingText ? ' / ' : '') + `${status.remainingDays} days`;

                message += `${emoji} *${st.name}*\n`;
                message += `   Every ${intervalText} | ${remainingText} left\n`;
            }
        }

        const buttons = [
            [Markup.button.callback('➕ Add Service Type', `addservice_vehicle_${vehicleId}`)],
        ];

        if (serviceTypes.length > 0) {
            buttons.push([Markup.button.callback('✏️ Edit Service Type', `edit_servicetype_list_${vehicleId}`)]);
            buttons.push([Markup.button.callback('🗑️ Remove Service Type', `remove_servicetype_list_${vehicleId}`)]);
        }

        buttons.push([Markup.button.callback('« Back', `edit_vehicle_${vehicleId}`)]);

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        });
        await ctx.answerCbQuery();
    });

    // List service types for editing
    bot.action(/^edit_servicetype_list_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const serviceTypes = db.getServiceTypesByVehicle(vehicleId);

        const buttons = serviceTypes.map(st => [
            Markup.button.callback(`✏️ ${st.name}`, `edit_servicetype_${st.id}`)
        ]);
        buttons.push([Markup.button.callback('« Back', `manage_services_${vehicleId}`)]);

        await ctx.editMessageText(
            '✏️ *Edit Service Type*\n\nSelect one to edit:',
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
        await ctx.answerCbQuery();
    });

    // Edit a service type
    bot.action(/^edit_servicetype_(\d+)$/, async (ctx) => {
        const serviceTypeId = parseInt(ctx.match[1]);
        const st = db.getServiceTypeById(serviceTypeId);

        if (!st) {
            await ctx.answerCbQuery('Service type not found');
            return;
        }

        await ctx.editMessageText(
            `✏️ *Editing: ${st.name}*\n\nCurrent interval: ${st.interval_km.toLocaleString()} km\n\nWhat would you like to change?`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📝 Rename', `edit_st_field_${serviceTypeId}_name`)],
                    [Markup.button.callback('📏 Change Interval', `edit_st_field_${serviceTypeId}_interval`)],
                    [Markup.button.callback('« Back', `manage_services_${st.vehicle_id}`)]
                ])
            }
        );
        await ctx.answerCbQuery();
    });

    // Handle service type field edit
    bot.action(/^edit_st_field_(\d+)_(name|interval)$/, async (ctx) => {
        const serviceTypeId = parseInt(ctx.match[1]);
        const field = ctx.match[2];

        ctx.session = ctx.session || {};
        ctx.session.editingServiceType = { serviceTypeId, field };

        const prompts = {
            name: 'Enter the new name:',
            interval: 'Enter the new interval (in km):'
        };

        await ctx.editMessageText(prompts[field]);
        await ctx.answerCbQuery();
    });

    // List service types for removal
    bot.action(/^remove_servicetype_list_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const serviceTypes = db.getServiceTypesByVehicle(vehicleId);

        const buttons = serviceTypes.map(st => [
            Markup.button.callback(`🗑️ ${st.name}`, `remove_servicetype_${st.id}`)
        ]);
        buttons.push([Markup.button.callback('« Back', `manage_services_${vehicleId}`)]);

        await ctx.editMessageText(
            '🗑️ *Remove Service Type*\n\nSelect one to remove:',
            { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
        );
        await ctx.answerCbQuery();
    });

    // Remove a service type
    bot.action(/^remove_servicetype_(\d+)$/, async (ctx) => {
        const serviceTypeId = parseInt(ctx.match[1]);
        const st = db.getServiceTypeById(serviceTypeId);

        if (!st) {
            await ctx.answerCbQuery('Service type not found');
            return;
        }

        db.deleteServiceType(serviceTypeId);
        await ctx.editMessageText(`✅ *${st.name}* has been removed.`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('« Back', `manage_services_${st.vehicle_id}`)]
            ])
        });
        await ctx.answerCbQuery('Removed!');
    });

    // Handle field edit selection
    bot.action(/^edit_field_(\d+)_(name|plate)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const field = ctx.match[2];

        ctx.session = ctx.session || {};
        ctx.session.editingVehicle = { vehicleId, field };

        const prompts = {
            name: 'Enter the new name:',
            plate: 'Enter the new plate number:'
        };

        await ctx.editMessageText(prompts[field]);
        await ctx.answerCbQuery();
    });

    // Cancel action
    bot.action('cancel_action', async (ctx) => {
        await ctx.editMessageText('❌ Action cancelled.');
        await ctx.answerCbQuery();
    });
}

/**
 * Handle text input for vehicle addition/editing
 */
function handleVehicleTextInput(ctx, session) {
    if (session.addingVehicle) {
        return handleAddVehicleInput(ctx, session);
    }
    if (session.addingServiceType) {
        return handleAddServiceTypeInput(ctx, session);
    }
    if (session.editingVehicle) {
        return handleEditVehicleInput(ctx, session);
    }
    if (session.editingServiceType) {
        return handleEditServiceTypeInput(ctx, session);
    }
    return false;
}

async function handleAddVehicleInput(ctx, session) {
    const { step, userId } = session.addingVehicle;
    const text = ctx.message.text.trim();

    switch (step) {
        case 'name':
            session.addingVehicle.name = text;
            session.addingVehicle.step = 'plate';
            await ctx.reply(
                `Great! *${text}* it is.\n\nNow enter the plate number:\n\n_Or send /skip if no plate_`,
                { parse_mode: 'Markdown' }
            );
            return true;

        case 'plate':
            if (text.toLowerCase() !== '/skip') {
                session.addingVehicle.plate = text;
            }
            session.addingVehicle.step = 'initial_km';
            await ctx.reply(
                `What's the current odometer reading (in km)?\n\n_This is your starting point for tracking_\n\n_Send /skip to start from 0_`,
                { parse_mode: 'Markdown' }
            );
            return true;

        case 'initial_km':
            let initialKm = 0;
            if (text.toLowerCase() !== '/skip') {
                initialKm = parseInt(text.replace(/[^\d]/g, ''));
                if (isNaN(initialKm) || initialKm < 0) {
                    await ctx.reply('Please enter a valid number (e.g., 45000) or /skip');
                    return true;
                }
            }

            // Create the vehicle
            const vehicleId = db.addVehicle(
                userId,
                session.addingVehicle.name,
                session.addingVehicle.plate || null,
                initialKm
            );

            const vehicle = db.getVehicleById(vehicleId);
            const user = db.getUserById(userId);

            // Sync to Google Sheets
            await sheets.syncVehicle(vehicle, user);

            delete session.addingVehicle;

            await ctx.reply(
                `✅ *Vehicle Added!*\n\n` +
                `🚗 *${vehicle.name}*\n` +
                `${vehicle.plate ? `🔖 Plate: ${vehicle.plate}\n` : ''}` +
                `📍 Starting at: ${initialKm.toLocaleString()} km\n\n` +
                `*Next step:* Add service types to track!\n` +
                `Use /addservice to add Oil Change, Tire Rotation, etc.`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('➕ Add Service Type', `addservice_vehicle_${vehicleId}`)]
                    ])
                }
            );
            return true;
    }
    return false;
}

async function handleAddServiceTypeInput(ctx, session) {
    const { step, vehicleId, vehicleName } = session.addingServiceType;
    const text = ctx.message.text.trim();

    switch (step) {
        case 'name':
            session.addingServiceType.name = text;
            session.addingServiceType.step = 'interval';
            await ctx.reply(
                `*${text}* - got it!\n\n` +
                `What's the service interval in km?\n\n` +
                `_Example: 5000 for every 5000 km_\n\n` +
                `_Or /skip for default 5000 km_`,
                { parse_mode: 'Markdown' }
            );
            return true;

        case 'interval':
            let interval = 5000;
            if (text.toLowerCase() !== '/skip') {
                interval = parseInt(text.replace(/[^\d]/g, ''));
                if (isNaN(interval) || interval <= 0) {
                    await ctx.reply('Please enter a valid number (e.g., 5000) or /skip');
                    return true;
                }
            }
            session.addingServiceType.interval = interval;
            session.addingServiceType.step = 'last_service';

            const currentVehicle = db.getVehicleById(vehicleId);
            await ctx.reply(
                `At what km was the last *${session.addingServiceType.name}* done?\n\n` +
                `_Current odometer: ${currentVehicle?.current_odo?.toLocaleString() || 0} km_\n\n` +
                `_Send /skip if you just did it (uses current odometer)_`,
                { parse_mode: 'Markdown' }
            );
            return true;

        case 'last_service':
            const vehicle = db.getVehicleById(vehicleId);
            let lastServiceOdo = vehicle?.current_odo || 0;

            if (text.toLowerCase() !== '/skip') {
                lastServiceOdo = parseInt(text.replace(/[^\d]/g, ''));
                if (isNaN(lastServiceOdo) || lastServiceOdo < 0) {
                    await ctx.reply('Please enter a valid number (e.g., 33000) or /skip');
                    return true;
                }
            }

            // Create the service type with the last service odometer
            const serviceTypeId = db.addServiceType(vehicleId, session.addingServiceType.name, session.addingServiceType.interval);
            db.updateServiceType(serviceTypeId, { last_service_odo: lastServiceOdo });

            const addedName = session.addingServiceType.name;
            const addedInterval = session.addingServiceType.interval;
            delete session.addingServiceType;

            await ctx.reply(
                `✅ *Service Type Added!*\n\n` +
                `🚗 ${vehicleName}\n` +
                `🔧 *${addedName}*\n` +
                `📏 Every ${addedInterval.toLocaleString()} km\n` +
                `📍 Last done at ${lastServiceOdo.toLocaleString()} km\n\n` +
                `_Use /addservice to add more, or /status to check all vehicles._`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('➕ Add Another', `addservice_vehicle_${vehicleId}`)],
                        [Markup.button.callback('📊 View Status', 'menu_status')]
                    ])
                }
            );
            return true;
    }
    return false;
}

async function handleEditVehicleInput(ctx, session) {
    const { vehicleId, field } = session.editingVehicle;
    const text = ctx.message.text.trim();

    const updates = {};

    switch (field) {
        case 'name':
            updates.name = text;
            break;
        case 'plate':
            updates.plate = text;
            break;
    }

    db.updateVehicle(vehicleId, updates);
    delete session.editingVehicle;

    await ctx.reply('✅ Vehicle updated successfully!');
    return true;
}

async function handleEditServiceTypeInput(ctx, session) {
    const { serviceTypeId, field } = session.editingServiceType;
    const text = ctx.message.text.trim();

    const updates = {};

    switch (field) {
        case 'name':
            updates.name = text;
            break;
        case 'interval':
            const interval = parseInt(text.replace(/[^\d]/g, ''));
            if (isNaN(interval) || interval <= 0) {
                await ctx.reply('Please enter a valid number (e.g., 5000)');
                return true;
            }
            updates.interval_km = interval;
            break;
    }

    db.updateServiceType(serviceTypeId, updates);
    delete session.editingServiceType;

    await ctx.reply('✅ Service type updated successfully!');
    return true;
}

module.exports = {
    registerVehicleHandlers,
    handleVehicleTextInput
};
