const { Markup } = require('telegraf');
const db = require('../db');
const sheets = require('../sheets');

/**
 * Register service-related command handlers
 */
function registerServiceHandlers(bot) {
    // /service - Record a service event
    bot.command('service', async (ctx) => {
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

        const buttons = vehicles.map(v => {
            const serviceStatuses = db.getServiceStatusForVehicle(v.id);
            const hasOverdue = serviceStatuses.some(s => s.status.isOverdue);
            const hasWarning = serviceStatuses.some(s => s.status.remaining <= 500);
            const emoji = hasOverdue ? '🔴' : hasWarning ? '🟡' : '🟢';
            return [Markup.button.callback(`${emoji} ${v.name}`, `service_vehicle_${v.id}`)];
        });
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_action')]);

        await ctx.reply(
            '🔧 *Record Service Event*\n\nSelect a vehicle:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    // Vehicle selection for service
    bot.action(/^service_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (!vehicle) {
            await ctx.answerCbQuery('Vehicle not found');
            return;
        }

        const serviceTypes = db.getServiceTypesByVehicle(vehicleId);

        if (serviceTypes.length === 0) {
            await ctx.editMessageText(
                `🔧 *${vehicle.name}*\n\nNo service types configured yet!\n\nYou need to add service types first.`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('➕ Add Service Type', `addservice_vehicle_${vehicleId}`)],
                        [Markup.button.callback('« Back', 'cancel_action')]
                    ])
                }
            );
            await ctx.answerCbQuery();
            return;
        }

        const buttons = serviceTypes.map(st => {
            const status = db.getServiceStatus(st, vehicle.current_odo);
            let remainingText = '';
            if (status.remainingKm !== null) remainingText = `${status.remainingKm.toLocaleString()} km`;
            else if (status.remainingDays !== null) remainingText = `${status.remainingDays} days`;

            const emoji = status.isOverdue ? '🔴' : ((status.remainingKm !== null && status.remainingKm <= 500) || (status.remainingDays !== null && status.remainingDays <= 7)) ? '🟡' : '🟢';
            return [Markup.button.callback(
                `${emoji} ${st.name} (${remainingText})`,
                `service_type_${st.id}`
            )];
        });
        buttons.push([Markup.button.callback('« Back', 'cancel_action')]);

        await ctx.editMessageText(
            `🔧 *Service for ${vehicle.name}*\n\n` +
            `Current odometer: ${vehicle.current_odo.toLocaleString()} km\n\n` +
            `Select which service was performed:`,
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
        await ctx.answerCbQuery();
    });

    // Service type selection
    bot.action(/^service_type_(\d+)$/, async (ctx) => {
        const serviceTypeId = parseInt(ctx.match[1]);
        const serviceType = db.getServiceTypeById(serviceTypeId);

        if (!serviceType) {
            await ctx.answerCbQuery('Service type not found');
            return;
        }

        const vehicle = db.getVehicleById(serviceType.vehicle_id);

        ctx.session = ctx.session || {};
        ctx.session.recordingService = {
            step: 'odometer',
            vehicleId: serviceType.vehicle_id,
            serviceTypeId,
            serviceTypeName: serviceType.name,
            vehicleName: vehicle?.name || 'Unknown'
        };

        await ctx.editMessageText(
            `🔧 *Recording: ${serviceType.name}*\n` +
            `🚗 ${vehicle?.name || 'Unknown'}\n\n` +
            `📍 What was the odometer reading at service?\n\n` +
            `_Current: ${vehicle?.current_odo.toLocaleString()} km_\n\n` +
            `Send /current to use current odometer`,
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCbQuery();
    });

    // /servicehistory - Show service history
    bot.command('servicehistory', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.reply('You don\'t have any vehicles yet.');
            return;
        }

        if (vehicles.length === 1) {
            await showServiceHistory(ctx, vehicles[0]);
        } else {
            const buttons = vehicles.map(v => [
                Markup.button.callback(v.name, `servicehistory_vehicle_${v.id}`)
            ]);

            await ctx.reply(
                '🔧 *Service History*\n\nSelect a vehicle:',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons)
                }
            );
        }
    });

    bot.action(/^servicehistory_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);
        await showServiceHistory(ctx, vehicle, true);
        await ctx.answerCbQuery();
    });
}

async function showServiceHistory(ctx, vehicle, isEdit = false) {
    const history = db.getServiceHistory(vehicle.id, 10);

    if (history.length === 0) {
        const message = `🔧 *${vehicle.name}* - No service records yet.\n\nUse /service to record your first service!`;
        if (isEdit) {
            await ctx.editMessageText(message, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply(message, { parse_mode: 'Markdown' });
        }
        return;
    }

    let message = `🔧 *${vehicle.name}* - Service History\n\n`;

    for (const service of history) {
        const date = new Date(service.created_at).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        message += `• *${service.service_type_name}*\n`;
        message += `  📍 ${service.odo_km.toLocaleString()} km | 📅 ${date}\n`;
        if (service.notes) {
            message += `  📝 ${service.notes}\n`;
        }
        message += '\n';
    }

    if (isEdit) {
        await ctx.editMessageText(message, { parse_mode: 'Markdown' });
    } else {
        await ctx.reply(message, { parse_mode: 'Markdown' });
    }
}

/**
 * Handle text input for service recording
 */
function handleServiceTextInput(ctx, session) {
    if (!session.recordingService) {
        return false;
    }

    return handleRecordServiceInput(ctx, session);
}

async function handleRecordServiceInput(ctx, session) {
    const { step, vehicleId, serviceTypeId, serviceTypeName, vehicleName } = session.recordingService;
    const text = ctx.message.text.trim();
    const vehicle = db.getVehicleById(vehicleId);

    switch (step) {
        case 'odometer':
            let odoValue;
            if (text.toLowerCase() === '/current') {
                odoValue = vehicle?.current_odo || 0;
            } else {
                odoValue = parseInt(text.replace(/[^\d]/g, ''));
                if (isNaN(odoValue) || odoValue <= 0) {
                    await ctx.reply('Please enter a valid number (e.g., 45000) or /current');
                    return true;
                }
            }

            session.recordingService.odoKm = odoValue;
            session.recordingService.step = 'notes';

            await ctx.reply(
                `📝 Any notes? (cost, parts replaced, etc.)\n\n_Send /skip if no notes_`,
                { parse_mode: 'Markdown' }
            );
            return true;

        case 'notes':
            const notes = text.toLowerCase() === '/skip' ? null : text;
            const { odoKm } = session.recordingService;

            const user = db.getOrCreateUser(
                ctx.from.id.toString(),
                ctx.from.username,
                ctx.from.first_name
            );

            // Log the service
            db.logService(vehicleId, serviceTypeId, odoKm, notes);

            // Get updated service type status
            const serviceType = db.getServiceTypeById(serviceTypeId);
            const updatedVehicle = db.getVehicleById(vehicleId);
            const status = db.getServiceStatus(serviceType, updatedVehicle.current_odo);

            // Sync to Google Sheets
            const latestService = {
                service_type_name: serviceTypeName,
                odo_km: odoKm,
                notes,
                created_at: new Date().toISOString()
            };
            await sheets.syncService(latestService, updatedVehicle, user);

            delete session.recordingService;

            let nextText = '';
            if (status.remainingKm !== null) nextText = `${status.remainingKm.toLocaleString()} km`;
            if (status.remainingDays !== null) nextText += (nextText ? ' / ' : '') + `${status.remainingDays} days`;

            await ctx.reply(
                `✅ *Service Recorded!*\n\n` +
                `🚗 ${vehicleName}\n` +
                `🔧 ${serviceTypeName}\n` +
                `📍 At ${odoKm.toLocaleString()} km\n` +
                `${notes ? `📝 ${notes}\n` : ''}` +
                `\n🟢 Next ${serviceTypeName} in ${nextText}`,
                { parse_mode: 'Markdown' }
            );
            return true;
    }

    return false;
}

module.exports = {
    registerServiceHandlers,
    handleServiceTextInput
};
