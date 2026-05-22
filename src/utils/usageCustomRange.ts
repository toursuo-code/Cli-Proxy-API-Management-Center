export interface CustomRangePoint {
  date: string;
  time: string;
}

export interface CustomRangeState {
  start: CustomRangePoint;
  end: CustomRangePoint;
  useCurrentEnd: boolean;
}

export const EMPTY_CUSTOM_RANGE: CustomRangeState = {
  start: { date: '', time: '' },
  end: { date: '', time: '' },
  useCurrentEnd: true,
};

const normalizePoint = (value: unknown): CustomRangePoint => {
  if (typeof value === 'string') {
    return splitDateTimeLocal(value);
  }

  if (!value || typeof value !== 'object') {
    return { date: '', time: '' };
  }

  const record = value as Record<string, unknown>;
  return {
    date: typeof record.date === 'string' ? record.date : '',
    time: typeof record.time === 'string' ? record.time : '',
  };
};

export const splitDateTimeLocal = (value: string): CustomRangePoint => {
  if (!value) {
    return { date: '', time: '' };
  }

  const [datePart = '', timePart = ''] = value.split('T');
  return {
    date: datePart,
    time: timePart.slice(0, 5),
  };
};

export const buildCustomRangePointFromDate = (value: Date): CustomRangePoint => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
};

export const parseStoredCustomRange = (raw: string | null | undefined): CustomRangeState => {
  if (!raw) {
    return EMPTY_CUSTOM_RANGE;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<{
      start: string | CustomRangePoint;
      end: string | CustomRangePoint;
      useCurrentEnd: boolean;
    }>;

    return {
      start: normalizePoint(parsed.start),
      end: normalizePoint(parsed.end),
      useCurrentEnd: typeof parsed.useCurrentEnd === 'boolean' ? parsed.useCurrentEnd : true,
    };
  } catch {
    return EMPTY_CUSTOM_RANGE;
  }
};

export const toCustomRangeTimestamp = (
  value: CustomRangePoint,
  boundary: 'start' | 'end'
): number | undefined => {
  if (!value.date) {
    return undefined;
  }

  const fallbackTime = boundary === 'start' ? '00:00' : '23:59';
  const timestamp = new Date(`${value.date}T${value.time || fallbackTime}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
};
