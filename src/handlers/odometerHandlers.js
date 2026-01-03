const { Markup } = require('telegraf');
const db = require('../db');
const sheets = require('../sheets');
const ocr = require('../ocr');

// Store pending odometer confirmations
const pendingOdometer = new Map();

/**
 * Register odometer-related command handlers
 */
function registerOdometerHandlers(bot) {
    // Handle photo messages (odometer OCR)
    bot.on('photo', async (ctx) => {
        const user = db.getOrCreateUser(
            ctx.from.id.toString(),
            ctx.from.username,
            ctx.from.first_name
        );

        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            await ctx.reply(
                '🚗 You need to add a vehicle first!\n\nUse /addvehicle to get started.',
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Get the largest photo (best quality)
        const photos = ctx.message.photo;
        const photo = photos[photos.length - 1];

        await ctx.reply('🔍 Processing odometer image...');

        // Process the photo with OCR
        const result = await ocr.processOdometerPhoto(ctx, photo.file_id);

        if (!result.success) {
            await ctx.reply(
                `❌ *OCR Failed*\n\n${result.error}\n\nYou can manually enter the reading with /logodo`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        // Store pending odometer for confirmation
        const pendingId = `${ctx.from.id}_${Date.now()}`;
        pendingOdometer.set(pendingId, {
            value: result.value,
            raw: result.raw,
            photoPath: result.photoPath,
            userId: user.id
        });

        // If only one vehicle, ask for confirmation
        // If multiple vehicles, ask which one
        if (vehicles.length === 1) {
            const vehicle = vehicles[0];
            pendingOdometer.get(pendingId).vehicleId = vehicle.id;

            // Check if value is lower than current odometer
            const isLower = result.value < vehicle.current_odo;
            let message = `📸 *Odometer Reading Detected*\n\n` +
                `🚗 Vehicle: *${vehicle.name}*\n` +
                `📍 Reading: *${result.value.toLocaleString()} km*\n`;

            if (isLower) {
                message += `\n⚠️ *Warning:* This is lower than current (${vehicle.current_odo.toLocaleString()} km)!\n`;
                message += `_Wrong photo?_\n`;
            }
            message += `\nIs this correct?`;

            await ctx.reply(message, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback(isLower ? '⚠️ Save Anyway' : '✅ Confirm', `confirm_odo_${pendingId}`),
                        Markup.button.callback('✏️ Edit', `edit_odo_${pendingId}`)
                    ],
                    [Markup.button.callback('❌ Cancel', `cancel_odo_${pendingId}`)]
                ])
            }
            );
        } else {
            // Multiple vehicles - ask which one
            const buttons = vehicles.map(v => [
                Markup.button.callback(v.name, `select_vehicle_odo_${pendingId}_${v.id}`)
            ]);
            buttons.push([Markup.button.callback('❌ Cancel', `cancel_odo_${pendingId}`)]);

            await ctx.reply(
                `📸 *Odometer Reading: ${result.value.toLocaleString()} km*\n\nWhich vehicle is this for?`,
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons)
                }
            );
        }
    });

    // Vehicle selection for odometer
    bot.action(/^select_vehicle_odo_(.+)_(\d+)$/, async (ctx) => {
        const pendingId = ctx.match[1];
        const vehicleId = parseInt(ctx.match[2]);
        const pending = pendingOdometer.get(pendingId);

        if (!pending) {
            await ctx.answerCbQuery('Session expired. Please send the photo again.');
            return;
        }

        pending.vehicleId = vehicleId;
        const vehicle = db.getVehicleById(vehicleId);

        // Check if value is lower than current odometer
        const isLower = pending.value < vehicle.current_odo;
        let message = `📸 *Odometer Reading Detected*\n\n` +
            `🚗 Vehicle: *${vehicle.name}*\n` +
            `📍 Reading: *${pending.value.toLocaleString()} km*\n`;

        if (isLower) {
            message += `\n⚠️ *Warning:* This is lower than current (${vehicle.current_odo.toLocaleString()} km)!\n`;
            message += `_Wrong photo?_\n`;
        }
        message += `\nIs this correct?`;

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback(isLower ? '⚠️ Save Anyway' : '✅ Confirm', `confirm_odo_${pendingId}`),
                    Markup.button.callback('✏️ Edit', `edit_odo_${pendingId}`)
                ],
                [Markup.button.callback('❌ Cancel', `cancel_odo_${pendingId}`)]
            ])
        }
        );
        await ctx.answerCbQuery();
    });

    // Confirm odometer reading
    bot.action(/^confirm_odo_(.+)$/, async (ctx) => {
        const pendingId = ctx.match[1];
        const pending = pendingOdometer.get(pendingId);

        if (!pending) {
            await ctx.answerCbQuery('Session expired. Please send the photo again.');
            return;
        }

        const vehicle = db.getVehicleById(pending.vehicleId);
        const user = db.getUserById(pending.userId);

        // Log the odometer reading
        db.logOdometer(
            pending.vehicleId,
            pending.value,
            pending.photoPath,
            pending.raw,
            'ocr'
        );

        // Get updated vehicle
        const updatedVehicle = db.getVehicleById(pending.vehicleId);
        const latestReading = db.getLatestOdometer(pending.vehicleId);

        // Sync to Google Sheets
        await sheets.syncReading(latestReading, updatedVehicle, user);
        await sheets.syncVehicle(updatedVehicle, user);

        // Get service status summary
        const serviceStatuses = db.getServiceStatusForVehicle(pending.vehicleId);

        pendingOdometer.delete(pendingId);

        let message = `✅ *Odometer Logged!*\n\n` +
            `🚗 ${updatedVehicle.name}\n` +
            `📍 ${pending.value.toLocaleString()} km\n\n`;

        if (serviceStatuses.length > 0) {
            const overdue = serviceStatuses.filter(s => s.status.isOverdue);
            const warning = serviceStatuses.filter(s => !s.status.isOverdue && (
                (s.status.remainingKm !== null && s.status.remainingKm <= 500) ||
                (s.status.remainingDays !== null && s.status.remainingDays <= 7)
            ));

            if (overdue.length > 0) {
                message += `🔴 *OVERDUE:*\n`;
                for (const s of overdue) {
                    let dueText = '';
                    if (s.status.remainingKm !== null && s.status.remainingKm <= 0) dueText = `${Math.abs(s.status.remainingKm).toLocaleString()} km`;
                    if (s.status.remainingDays !== null && s.status.remainingDays <= 0) {
                        if (dueText) dueText += ' / ';
                        dueText += `${Math.abs(s.status.remainingDays)} days`;
                    }
                    message += `  • ${s.name}: ${dueText} overdue\n`;
                }
            } else if (warning.length > 0) {
                message += `🟡 *Due soon:*\n`;
                for (const s of warning) {
                    let dueText = '';
                    if (s.status.remainingKm !== null) dueText = `${s.status.remainingKm.toLocaleString()} km`;
                    if (s.status.remainingDays !== null) {
                        if (dueText) dueText += ' / ';
                        dueText += `${s.status.remainingDays} days`;
                    }
                    message += `  • ${s.name}: ${dueText} left\n`;
                }
            }

            // Show top 3 upcoming services if not overdue/warning
            if (overdue.length === 0 && warning.length === 0) {
                message += `🟢 *Next Services:*\n`;
                const upcoming = serviceStatuses.sort((a, b) => a.status.remaining - b.status.remaining).slice(0, 3);
                for (const s of upcoming) {
                    let dueText = '';
                    if (s.status.remainingKm !== null) dueText = `${s.status.remainingKm.toLocaleString()} km`;
                    if (s.status.remainingDays !== null) {
                        if (dueText) dueText += ' / ';
                        dueText += `${s.status.remainingDays} days`;
                    }
                    message += `  • ${s.name}: ${dueText} left\n`;
                }
            }
        }

        await ctx.editMessageText(message, { parse_mode: 'Markdown' });
        await ctx.answerCbQuery('Saved!');
    });

    // Edit odometer reading
    bot.action(/^edit_odo_(.+)$/, async (ctx) => {
        const pendingId = ctx.match[1];
        const pending = pendingOdometer.get(pendingId);

        if (!pending) {
            await ctx.answerCbQuery('Session expired. Please send the photo again.');
            return;
        }

        ctx.session = ctx.session || {};
        ctx.session.editingOdometer = { pendingId };

        await ctx.editMessageText(
            `📝 Enter the correct odometer reading (in km):`,
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCbQuery();
    });

    // Cancel odometer
    bot.action(/^cancel_odo_(.+)$/, async (ctx) => {
        const pendingId = ctx.match[1];
        pendingOdometer.delete(pendingId);
        await ctx.editMessageText('❌ Cancelled.');
        await ctx.answerCbQuery();
    });

    // /logodo - Manual odometer entry
    bot.command('logodo', async (ctx) => {
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
            Markup.button.callback(`${v.name} (${v.current_odo.toLocaleString()} km)`, `logodo_vehicle_${v.id}`)
        ]);
        buttons.push([Markup.button.callback('❌ Cancel', 'cancel_action')]);

        await ctx.reply(
            '📝 *Log Odometer Reading*\n\nSelect a vehicle:',
            {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    // Vehicle selection for manual odometer
    bot.action(/^logodo_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);

        ctx.session = ctx.session || {};
        ctx.session.loggingOdometer = { vehicleId };

        const vehicle = db.getVehicleById(vehicleId);

        await ctx.editMessageText(
            `📝 *${vehicle.name}*\n\nEnter the current odometer reading (in km):`,
            { parse_mode: 'Markdown' }
        );
        await ctx.answerCbQuery();
    });

    // /history - Show odometer history
    bot.command('history', async (ctx) => {
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
            await showOdometerHistory(ctx, vehicles[0]);
        } else {
            const buttons = vehicles.map(v => [
                Markup.button.callback(v.name, `history_vehicle_${v.id}`)
            ]);

            await ctx.reply(
                '📊 *Odometer History*\n\nSelect a vehicle:',
                {
                    parse_mode: 'Markdown',
                    ...Markup.inlineKeyboard(buttons)
                }
            );
        }
    });

    bot.action(/^history_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);
        await showOdometerHistory(ctx, vehicle, true);
        await ctx.answerCbQuery();
    });
}

async function showOdometerHistory(ctx, vehicle, isEdit = false) {
    const history = db.getOdometerHistory(vehicle.id, 10);

    if (history.length === 0) {
        const message = `📊 *${vehicle.name}* - No readings yet.\n\nSend a photo of your odometer to start tracking!`;
        if (isEdit) {
            await ctx.editMessageText(message, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply(message, { parse_mode: 'Markdown' });
        }
        return;
    }

    let message = `📊 *${vehicle.name}* - Recent Readings\n\n`;

    for (const reading of history) {
        const date = new Date(reading.created_at).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
        const icon = reading.source === 'ocr' ? '📷' : '✏️';
        message += `${icon} ${reading.odo_km.toLocaleString()} km - ${date}\n`;
    }

    if (isEdit) {
        await ctx.editMessageText(message, { parse_mode: 'Markdown' });
    } else {
        await ctx.reply(message, { parse_mode: 'Markdown' });
    }
}

/**
 * Handle text input for odometer
 */
function handleOdometerTextInput(ctx, session) {
    if (session.editingOdometer) {
        return handleEditOdometerInput(ctx, session);
    }
    if (session.loggingOdometer) {
        return handleManualOdometerInput(ctx, session);
    }
    return false;
}

async function handleEditOdometerInput(ctx, session) {
    const { pendingId } = session.editingOdometer;
    const pending = pendingOdometer.get(pendingId);

    if (!pending) {
        delete session.editingOdometer;
        await ctx.reply('Session expired. Please send the photo again.');
        return true;
    }

    const value = parseInt(ctx.message.text.replace(/[^\d]/g, ''));
    if (isNaN(value) || value <= 0) {
        await ctx.reply('Please enter a valid number (e.g., 45000)');
        return true;
    }

    pending.value = value;
    delete session.editingOdometer;

    const vehicle = db.getVehicleById(pending.vehicleId);
    const user = db.getUserById(pending.userId);

    // Log the odometer reading
    db.logOdometer(
        pending.vehicleId,
        pending.value,
        pending.photoPath,
        pending.raw,
        'ocr'
    );

    // Get updated vehicle
    const updatedVehicle = db.getVehicleById(pending.vehicleId);
    const latestReading = db.getLatestOdometer(pending.vehicleId);

    // Sync to Google Sheets
    await sheets.syncReading(latestReading, updatedVehicle, user);
    await sheets.syncVehicle(updatedVehicle, user);

    // Get service status summary
    const serviceStatuses = db.getServiceStatusForVehicle(pending.vehicleId);

    pendingOdometer.delete(pendingId);

    let message = `✅ *Odometer Logged!*\n\n` +
        `🚗 ${updatedVehicle.name}\n` +
        `📍 ${pending.value.toLocaleString()} km\n\n`;

    if (serviceStatuses.length > 0) {
        const overdue = serviceStatuses.filter(s => s.status.isOverdue);
        const warning = serviceStatuses.filter(s => !s.status.isOverdue && (
            (s.status.remainingKm !== null && s.status.remainingKm <= 500) ||
            (s.status.remainingDays !== null && s.status.remainingDays <= 7)
        ));

        if (overdue.length > 0) {
            message += `🔴 *OVERDUE:*\n`;
            for (const s of overdue) {
                let dueText = '';
                if (s.status.remainingKm !== null && s.status.remainingKm <= 0) dueText = `${Math.abs(s.status.remainingKm).toLocaleString()} km`;
                if (s.status.remainingDays !== null && s.status.remainingDays <= 0) {
                    if (dueText) dueText += ' / ';
                    dueText += `${Math.abs(s.status.remainingDays)} days`;
                }
                message += `  • ${s.name}: ${dueText} overdue\n`;
            }
        } else if (warning.length > 0) {
            message += `🟡 *Due soon:*\n`;
            for (const s of warning) {
                let dueText = '';
                if (s.status.remainingKm !== null) dueText = `${s.status.remainingKm.toLocaleString()} km`;
                if (s.status.remainingDays !== null) {
                    if (dueText) dueText += ' / ';
                    dueText += `${s.status.remainingDays} days`;
                }
                message += `  • ${s.name}: ${dueText} left\n`;
            }
        } else {
            message += `🟢 *Next Services:*\n`;
            const upcoming = serviceStatuses.sort((a, b) => a.status.remaining - b.status.remaining).slice(0, 3);
            for (const s of upcoming) {
                let dueText = '';
                if (s.status.remainingKm !== null) dueText = `${s.status.remainingKm.toLocaleString()} km`;
                if (s.status.remainingDays !== null) {
                    if (dueText) dueText += ' / ';
                    dueText += `${s.status.remainingDays} days`;
                }
                message += `  • ${s.name}: ${dueText} left\n`;
            }
        }
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
    return true;
}

async function handleManualOdometerInput(ctx, session) {
    const { vehicleId, confirmLower } = session.loggingOdometer;

    const value = parseInt(ctx.message.text.replace(/[^\d]/g, ''));
    if (isNaN(value) || value <= 0) {
        await ctx.reply('Please enter a valid number (e.g., 45000)');
        return true;
    }

    const vehicle = db.getVehicleById(vehicleId);

    // Check if value is lower than current and not already confirmed
    if (value < vehicle.current_odo && !confirmLower) {
        session.loggingOdometer.pendingValue = value;
        session.loggingOdometer.awaitingConfirm = true;

        await ctx.reply(
            `⚠️ *Warning*\\n\\n` +
            `${value.toLocaleString()} km is *lower* than current reading (${vehicle.current_odo.toLocaleString()} km).\\n\\n` +
            `Wrong input? Type the correct value, or type "yes" to save anyway.`,
            { parse_mode: 'Markdown' }
        );
        return true;
    }

    // Handle "yes" confirmation for lower value
    if (session.loggingOdometer.awaitingConfirm) {
        const text = ctx.message.text.toLowerCase().trim();
        if (text === 'yes' || text === 'y') {
            // Use the pending value
            session.loggingOdometer.awaitingConfirm = false;
            return await saveManualOdometer(ctx, session, session.loggingOdometer.pendingValue);
        } else {
            // Try parsing as a new number
            const newValue = parseInt(text.replace(/[^\d]/g, ''));
            if (!isNaN(newValue) && newValue > 0) {
                session.loggingOdometer.awaitingConfirm = false;
                // Recursively validate the new value
                if (newValue < vehicle.current_odo) {
                    session.loggingOdometer.pendingValue = newValue;
                    session.loggingOdometer.awaitingConfirm = true;
                    await ctx.reply(
                        `⚠️ ${newValue.toLocaleString()} km is still lower than current (${vehicle.current_odo.toLocaleString()} km).\\n\\nType "yes" to save anyway, or enter a different value.`,
                        { parse_mode: 'Markdown' }
                    );
                    return true;
                }
                return await saveManualOdometer(ctx, session, newValue);
            }
            await ctx.reply('Please enter a valid number or type "yes" to confirm.');
            return true;
        }
    }

    return await saveManualOdometer(ctx, session, value);
}

async function saveManualOdometer(ctx, session, value) {
    const { vehicleId } = session.loggingOdometer;

    const vehicle = db.getVehicleById(vehicleId);
    const user = db.getOrCreateUser(
        ctx.from.id.toString(),
        ctx.from.username,
        ctx.from.first_name
    );

    // Log the odometer reading
    db.logOdometer(vehicleId, value, null, null, 'manual');

    // Get updated data
    const updatedVehicle = db.getVehicleById(vehicleId);
    const latestReading = db.getLatestOdometer(vehicleId);

    // Sync to Google Sheets
    await sheets.syncReading(latestReading, updatedVehicle, user);
    await sheets.syncVehicle(updatedVehicle, user);

    // Get service status summary
    const serviceStatuses = db.getServiceStatusForVehicle(vehicleId);

    delete session.loggingOdometer;

    let message = `✅ *Odometer Logged!*\n\n` +
        `🚗 ${updatedVehicle.name}\n` +
        `📍 ${value.toLocaleString()} km\n\n`;

    if (serviceStatuses.length > 0) {
        const overdue = serviceStatuses.filter(s => s.status.isOverdue);
        const warning = serviceStatuses.filter(s => !s.status.isOverdue && (
            (s.status.remainingKm !== null && s.status.remainingKm <= 500) ||
            (s.status.remainingDays !== null && s.status.remainingDays <= 7)
        ));

        if (overdue.length > 0) {
            message += `🔴 *OVERDUE:*\n`;
            for (const s of overdue) {
                let dueText = '';
                if (s.status.remainingKm !== null && s.status.remainingKm <= 0) dueText = `${Math.abs(s.status.remainingKm).toLocaleString()} km`;
                if (s.status.remainingDays !== null && s.status.remainingDays <= 0) {
                    if (dueText) dueText += ' / ';
                    dueText += `${Math.abs(s.status.remainingDays)} days`;
                }
                message += `  • ${s.name}: ${dueText} overdue\n`;
            }
        } else if (warning.length > 0) {
            message += `🟡 *Due soon:*\n`;
            for (const s of warning) {
                let dueText = '';
                if (s.status.remainingKm !== null) dueText = `${s.status.remainingKm.toLocaleString()} km`;
                if (s.status.remainingDays !== null) {
                    if (dueText) dueText += ' / ';
                    dueText += `${s.status.remainingDays} days`;
                }
                message += `  • ${s.name}: ${dueText} left\n`;
            }
        } else {
            message += `🟢 *Next Services:*\n`;
            const upcoming = serviceStatuses.sort((a, b) => a.status.remaining - b.status.remaining).slice(0, 3);
            for (const s of upcoming) {
                let dueText = '';
                if (s.status.remainingKm !== null) dueText = `${s.status.remainingKm.toLocaleString()} km`;
                if (s.status.remainingDays !== null) {
                    if (dueText) dueText += ' / ';
                    dueText += `${s.status.remainingDays} days`;
                }
                message += `  • ${s.name}: ${dueText} left\n`;
            }
        }
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
    return true;
}

module.exports = {
    registerOdometerHandlers,
    handleOdometerTextInput,
    pendingOdometer
};
