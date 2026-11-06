import openingHours from 'opening_hours';

const getCityLocalDate = (date, timezone) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second),
    );
};

export const getOpeningStatus = (openingHoursValue, arrivalTime, timezone = 'Asia/Kolkata') => {
    if (typeof openingHoursValue !== 'string' || !openingHoursValue.trim()) {
        return { status: 'unknown', reason: 'Opening hours are not mapped' };
    }

    try {
        const schedule = new openingHours(
            openingHoursValue,
            null,
            { tag_key: 'opening_hours', locale: 'en' },
        );
        const cityLocalDate = getCityLocalDate(arrivalTime, timezone);
        if (schedule.getUnknown(cityLocalDate)) {
            return { status: 'unknown', reason: 'Opening-hours rule is conditional or unknown' };
        }
        return {
            status: schedule.getState(cityLocalDate) ? 'open' : 'closed',
            reason: null,
        };
    } catch (error) {
        return { status: 'unknown', reason: 'Opening-hours value is invalid' };
    }
};

export const getCityLocalDateTime = getCityLocalDate;
