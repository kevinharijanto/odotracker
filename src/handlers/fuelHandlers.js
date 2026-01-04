const { Markup } = require('telegraf');
const db = require('../db');
const sheets = require('../sheets');

// Fuel brand options
const FUEL_BRANDS = ['Pertamina', 'Shell', 'BP', 'Total', 'Vivo', 'Other'];

/**
 * Register fuel-related command handlers
 */
function registerFuelHandlers(bot) {
    // /fuel or /refuel - Start fuel logging flow
    bot.command(['fuel', 'refuel'], async (ctx) => {
        const telegramId = ctx.from.id.toString();
        const user = db.getOrCreateUser(telegramId, ctx.from.username, ctx.from.first_name);
        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            return ctx.reply(
                '🚗 You don\'t have any vehicles yet!\n\nUse /addvehicle to add one first.',
                { parse_mode: 'Markdown' }
            );
        }

        // If only one vehicle, skip selection
        if (vehicles.length === 1) {
            ctx.session.fuelLog = { vehicleId: vehicles[0].id, step: 'liters' };
            const lastFuel = db.getLastFuelLog(vehicles[0].id);
            const lastInfo = lastFuel ? `\n📍 Last refuel: ${lastFuel.odo_km.toLocaleString()} km` : '';

            return ctx.reply(
                `⛽ *Fuel Log* \\- ${escapeMarkdown(vehicles[0].name)}${escapeMarkdown(lastInfo)}\n\n` +
                `How many liters did you fill?\n` +
                `Reply with a number \\(e\\.g\\., 25 or 25\\.5\\)`,
                { parse_mode: 'MarkdownV2' }
            );
        }

        // Multiple vehicles - show selection
        const buttons = vehicles.map(v => {
            const icon = v.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
            return [Markup.button.callback(
                `${icon} ${v.name} (${v.current_odo.toLocaleString()} km)`,
                `fuel_vehicle_${v.id}`
            )];
        });

        ctx.reply(
            '⛽ *Fuel Log* \\- Select Vehicle\n\nWhich vehicle are you refueling?',
            {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    // Vehicle selection callback
    bot.action(/^fuel_vehicle_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (!vehicle) {
            return ctx.answerCbQuery('Vehicle not found');
        }

        ctx.session.fuelLog = { vehicleId, step: 'liters' };
        await ctx.answerCbQuery();

        const lastFuel = db.getLastFuelLog(vehicleId);
        const lastInfo = lastFuel ? `\n📍 Last refuel: ${lastFuel.odo_km.toLocaleString()} km` : '';

        await ctx.editMessageText(
            `⛽ *Fuel Log* \\- ${escapeMarkdown(vehicle.name)}${escapeMarkdown(lastInfo)}\n\n` +
            `How many liters did you fill?\n` +
            `Reply with a number \\(e\\.g\\., 25 or 25\\.5\\)`,
            { parse_mode: 'MarkdownV2' }
        );
    });

    // Fuel brand selection callback
    bot.action(/^fuel_brand_(.+)$/, async (ctx) => {
        const brand = ctx.match[1];
        const session = ctx.session.fuelLog;

        if (!session || session.step !== 'brand') {
            return ctx.answerCbQuery('Session expired, please start over with /fuel');
        }

        session.brand = brand;
        session.step = 'cost';
        await ctx.answerCbQuery();

        await ctx.editMessageText(
            `⛽ *Fuel Log*\n\n` +
            `📍 ${session.odoKm.toLocaleString()} km\n` +
            `⛽ ${session.liters} L at ${brand}\n\n` +
            `💰 How much did you pay? \\(Rupiah\\)\n\n` +
            `Reply with the total cost or /skip to skip`,
            { parse_mode: 'MarkdownV2' }
        );
    });

    // /fuelhistory - View fuel history
    bot.command('fuelhistory', async (ctx) => {
        const telegramId = ctx.from.id.toString();
        const user = db.getOrCreateUser(telegramId, ctx.from.username, ctx.from.first_name);
        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            return ctx.reply('🚗 You don\'t have any vehicles yet!');
        }

        // If only one vehicle, show directly
        if (vehicles.length === 1) {
            return showFuelHistory(ctx, vehicles[0]);
        }

        // Multiple vehicles - show selection
        const buttons = vehicles.map(v => {
            const icon = v.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
            return [Markup.button.callback(
                `${icon} ${v.name}`,
                `fuelhistory_${v.id}`
            )];
        });

        ctx.reply(
            '⛽ *Fuel History* \\- Select Vehicle',
            {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    bot.action(/^fuelhistory_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (!vehicle) {
            return ctx.answerCbQuery('Vehicle not found');
        }

        await ctx.answerCbQuery();
        await ctx.deleteMessage().catch(() => { });
        return showFuelHistory(ctx, vehicle);
    });

    // /fuelstats - View efficiency stats
    bot.command('fuelstats', async (ctx) => {
        const telegramId = ctx.from.id.toString();
        const user = db.getOrCreateUser(telegramId, ctx.from.username, ctx.from.first_name);
        const vehicles = db.getVehiclesByUser(user.id);

        if (vehicles.length === 0) {
            return ctx.reply('🚗 You don\'t have any vehicles yet!');
        }

        // If only one vehicle, show directly
        if (vehicles.length === 1) {
            return showFuelStats(ctx, vehicles[0]);
        }

        // Multiple vehicles - show selection
        const buttons = vehicles.map(v => {
            const icon = v.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
            return [Markup.button.callback(
                `${icon} ${v.name}`,
                `fuelstats_${v.id}`
            )];
        });

        ctx.reply(
            '📊 *Fuel Stats* \\- Select Vehicle',
            {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard(buttons)
            }
        );
    });

    bot.action(/^fuelstats_(\d+)$/, async (ctx) => {
        const vehicleId = parseInt(ctx.match[1]);
        const vehicle = db.getVehicleById(vehicleId);

        if (!vehicle) {
            return ctx.answerCbQuery('Vehicle not found');
        }

        await ctx.answerCbQuery();
        await ctx.deleteMessage().catch(() => { });
        return showFuelStats(ctx, vehicle);
    });
}

/**
 * Show fuel history for a vehicle
 */
async function showFuelHistory(ctx, vehicle) {
    const history = db.getFuelHistory(vehicle.id, 10);

    if (history.length === 0) {
        return ctx.reply(
            `⛽ *Fuel History* \\- ${escapeMarkdown(vehicle.name)}\n\n` +
            `No fuel logs yet\\. Use /fuel to log your first refuel\\!`,
            { parse_mode: 'MarkdownV2' }
        );
    }

    const icon = vehicle.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
    let message = `⛽ *Fuel History* \\- ${icon} ${escapeMarkdown(vehicle.name)}\n\n`;

    for (const log of history) {
        const date = new Date(log.created_at).toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        const efficiency = log.km_per_liter ? `${log.km_per_liter} km/L` : 'N/A';
        const cost = log.cost ? `Rp ${log.cost.toLocaleString('id-ID')}` : '';

        message += `📅 ${escapeMarkdown(date)}\n`;
        message += `   ${log.liters}L ${escapeMarkdown(log.fuel_brand)} @ ${log.odo_km.toLocaleString()} km\n`;
        message += `   📊 ${escapeMarkdown(efficiency)}`;
        if (cost) message += ` \\| 💰 ${escapeMarkdown(cost)}`;
        message += `\n\n`;
    }

    message += `_Use /fuelstats for efficiency comparison_`;

    return ctx.reply(message, { parse_mode: 'MarkdownV2' });
}

/**
 * Show fuel efficiency stats for a vehicle
 */
async function showFuelStats(ctx, vehicle) {
    const stats = db.getFuelEfficiencyStats(vehicle.id);

    if (!stats.overall || stats.overall.fill_count === 0) {
        return ctx.reply(
            `📊 *Fuel Stats* \\- ${escapeMarkdown(vehicle.name)}\n\n` +
            `Not enough data yet\\. Log at least 2 refuels to see efficiency stats\\!`,
            { parse_mode: 'MarkdownV2' }
        );
    }

    const icon = vehicle.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
    const overallAvg = stats.overall.avg_km_per_liter
        ? stats.overall.avg_km_per_liter.toFixed(1)
        : 'N/A';

    let message = `📊 *Fuel Stats* \\- ${icon} ${escapeMarkdown(vehicle.name)}\n\n`;
    message += `*Overall:* ${overallAvg} km/L \\(${stats.overall.fill_count} fills\\)\n\n`;

    if (stats.byBrand.length > 0) {
        message += `*By Station:*\n`;

        // Brand icons
        const brandIcons = {
            'Pertamina': '🔴',
            'Shell': '🟡',
            'BP': '🟢',
            'Total': '🔵',
            'Vivo': '🟣',
            'Other': '⚪'
        };

        // Find best brand
        const bestBrand = stats.byBrand[0];

        for (const brand of stats.byBrand) {
            const brandIcon = brandIcons[brand.fuel_brand] || '⚪';
            const avg = brand.avg_km_per_liter ? brand.avg_km_per_liter.toFixed(1) : 'N/A';
            const isBest = brand.fuel_brand === bestBrand.fuel_brand && stats.byBrand.length > 1;

            message += `${brandIcon} ${escapeMarkdown(brand.fuel_brand)}: ${avg} km/L \\(${brand.fill_count} fills\\)`;
            if (isBest) message += ` ⭐ Best`;
            message += `\n`;
        }

        // Show efficiency tip if there's a noticeable difference
        if (stats.byBrand.length >= 2) {
            const best = stats.byBrand[0].avg_km_per_liter;
            const worst = stats.byBrand[stats.byBrand.length - 1].avg_km_per_liter;

            if (best && worst && best > worst) {
                const diff = ((best - worst) / worst * 100).toFixed(0);
                if (diff >= 3) {
                    message += `\n💡 _${escapeMarkdown(stats.byBrand[0].fuel_brand)} gives you ~${diff}% better efficiency\\!_`;
                }
            }
        }
    }

    return ctx.reply(message, { parse_mode: 'MarkdownV2' });
}

/**
 * Handle text input for fuel logging flow
 */
async function handleFuelTextInput(ctx, session) {
    if (!session.fuelLog) return false;

    const fuelSession = session.fuelLog;
    const text = ctx.message.text.trim();

    // Handle /skip for cost
    if (text.toLowerCase() === '/skip' && fuelSession.step === 'cost') {
        return saveFuelLog(ctx, fuelSession, null);
    }

    switch (fuelSession.step) {
        case 'liters':
            return handleLitersInput(ctx, fuelSession, text);
        case 'odo':
            return handleOdoInput(ctx, fuelSession, text);
        case 'cost':
            return handleCostInput(ctx, fuelSession, text);
        default:
            return false;
    }
}

async function handleLitersInput(ctx, session, text) {
    const liters = parseFloat(text.replace(',', '.'));

    if (isNaN(liters) || liters <= 0 || liters > 200) {
        await ctx.reply('❌ Please enter a valid number of liters (e.g., 25 or 25.5)');
        return true;
    }

    session.liters = liters;
    session.step = 'odo';

    const vehicle = db.getVehicleById(session.vehicleId);
    const lastOdo = vehicle ? vehicle.current_odo : 0;

    await ctx.reply(
        `📍 *Current odometer reading?*\n\n` +
        `Last known: ${lastOdo.toLocaleString()} km\n` +
        `Reply with the current km`,
        { parse_mode: 'Markdown' }
    );

    return true;
}

async function handleOdoInput(ctx, session, text) {
    // Parse odometer value (remove commas, dots as thousand separators)
    const cleanedText = text.replace(/[,.\s]/g, '');
    const odoKm = parseInt(cleanedText);

    if (isNaN(odoKm) || odoKm <= 0) {
        await ctx.reply('❌ Please enter a valid odometer reading (e.g., 45230)');
        return true;
    }

    const vehicle = db.getVehicleById(session.vehicleId);

    // Validate odo is higher than last reading
    if (vehicle && odoKm < vehicle.current_odo) {
        await ctx.reply(
            `⚠️ This reading (${odoKm.toLocaleString()} km) is lower than the last reading (${vehicle.current_odo.toLocaleString()} km).\n\n` +
            `Please enter a valid reading or /skip to cancel.`
        );
        return true;
    }

    session.odoKm = odoKm;
    session.step = 'brand';

    // Show fuel brand selection
    const buttons = [];
    for (let i = 0; i < FUEL_BRANDS.length; i += 2) {
        const row = [];
        row.push(Markup.button.callback(FUEL_BRANDS[i], `fuel_brand_${FUEL_BRANDS[i]}`));
        if (FUEL_BRANDS[i + 1]) {
            row.push(Markup.button.callback(FUEL_BRANDS[i + 1], `fuel_brand_${FUEL_BRANDS[i + 1]}`));
        }
        buttons.push(row);
    }

    await ctx.reply(
        '⛽ Which fuel station?',
        Markup.inlineKeyboard(buttons)
    );

    return true;
}

async function handleCostInput(ctx, session, text) {
    // Parse cost (remove "Rp", commas, dots, spaces)
    const cleanedText = text.replace(/[Rp,.\s]/gi, '');
    const cost = parseInt(cleanedText);

    if (isNaN(cost) || cost < 0) {
        await ctx.reply('❌ Please enter a valid cost (e.g., 150000) or /skip');
        return true;
    }

    return saveFuelLog(ctx, session, cost);
}

async function saveFuelLog(ctx, session, cost) {
    const vehicle = db.getVehicleById(session.vehicleId);
    if (!vehicle) {
        delete ctx.session.fuelLog;
        return ctx.reply('❌ Vehicle not found. Please start over with /fuel');
    }

    try {
        const result = db.addFuelLog(
            session.vehicleId,
            session.odoKm,
            session.liters,
            session.brand,
            null, // fuelType (can add later)
            cost
        );

        const icon = vehicle.vehicle_type === 'motorcycle' ? '🏍️' : '🚗';
        let message = `✅ *Fuel log saved\\!*\n\n`;
        message += `${icon} ${escapeMarkdown(vehicle.name)}\n`;
        message += `⛽ ${session.liters}L at ${escapeMarkdown(session.brand)}\n`;
        message += `📍 ${session.odoKm.toLocaleString()} km\n`;

        if (cost) {
            const pricePerLiter = Math.round(cost / session.liters);
            message += `💰 Rp ${cost.toLocaleString('id-ID')} \\(Rp ${pricePerLiter.toLocaleString('id-ID')}/L\\)\n`;
        }

        message += `\n`;

        // Show efficiency
        if (result.kmPerLiter) {
            message += `📊 *This fill:* ${result.kmPerLiter} km/L\n`;
        } else {
            message += `📊 _Efficiency will be calculated on next refuel_\n`;
        }

        // Show average for this brand
        const stats = db.getFuelEfficiencyStats(session.vehicleId);
        const brandStats = stats.byBrand.find(b => b.fuel_brand === session.brand);

        if (brandStats && brandStats.fill_count > 1) {
            message += `📈 *Avg \\(${escapeMarkdown(session.brand)}\\):* ${brandStats.avg_km_per_liter.toFixed(1)} km/L\n`;
        }

        if (stats.overall && stats.overall.fill_count > 1) {
            message += `📈 *Avg \\(All\\):* ${stats.overall.avg_km_per_liter.toFixed(1)} km/L`;
        }

        delete ctx.session.fuelLog;

        await ctx.reply(message, {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('📊 View Stats', `fuelstats_${session.vehicleId}`)],
                [Markup.button.callback('⛽ Log Another', `fuel_vehicle_${session.vehicleId}`)]
            ])
        });

        // Sync to Google Sheets if enabled
        try {
            await sheets.logFuelEntry(vehicle, session.odoKm, session.liters, session.brand, cost, result.kmPerLiter);
        } catch (e) {
            console.error('Failed to sync fuel to sheets:', e.message);
        }

        return true;
    } catch (error) {
        console.error('Error saving fuel log:', error);
        delete ctx.session.fuelLog;
        await ctx.reply('❌ Failed to save fuel log. Please try again.');
        return true;
    }
}

/**
 * Escape special characters for MarkdownV2
 */
function escapeMarkdown(text) {
    if (!text) return '';
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

module.exports = {
    registerFuelHandlers,
    handleFuelTextInput
};
