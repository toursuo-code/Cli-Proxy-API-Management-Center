import { useState, useMemo, useCallback, useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { providersApi } from '@/services/api';
import { useConfigStore } from '@/stores';
import type { OpenAIProviderConfig } from '@/types';
import {
  StatCards,
  ApiDetailsCard,
  ModelStatsCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  useUsageData,
  useSparklines,
} from '@/components/usage';
import {
  getApiStats,
  getModelStats,
  filterUsageByTimeRange,
  type UsageTimeRange,
  type UsageTimeWindow,
} from '@/utils/usage';
import {
  buildCustomRangePointFromDate,
  EMPTY_CUSTOM_RANGE,
  parseStoredCustomRange,
  toCustomRangeTimestamp,
  type CustomRangeState,
} from '@/utils/usageCustomRange';
import styles from './UsagePage.module.scss';

// Register Chart.js components
ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v2';
const CUSTOM_RANGE_STORAGE_KEY = 'cli-proxy-usage-custom-range-v1';
const DEFAULT_TIME_RANGE: UsageTimeRange = 'today';
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: 'all', labelKey: 'usage_stats.range_all' },
  { value: 'today', labelKey: 'usage_stats.range_today' },
  { value: 'yesterday', labelKey: 'usage_stats.range_yesterday' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: 'custom', labelKey: 'usage_stats.range_custom' },
];

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === 'today' ||
  value === 'yesterday' ||
  value === '7d' ||
  value === 'all' ||
  value === 'custom';

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

const loadCustomRange = (): CustomRangeState => {
  try {
    if (typeof localStorage === 'undefined') return EMPTY_CUSTOM_RANGE;
    return parseStoredCustomRange(localStorage.getItem(CUSTOM_RANGE_STORAGE_KEY));
  } catch {
    return EMPTY_CUSTOM_RANGE;
  }
};

type PickerInputElement = HTMLInputElement & { showPicker?: () => void };

export function UsagePage() {
  const { t } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const openaiCompatibilityConfig = config?.openaiCompatibility;
  const [openaiProvidersWithAuthIndex, setOpenaiProvidersWithAuthIndex] = useState<{
    source: OpenAIProviderConfig[] | undefined;
    providers: OpenAIProviderConfig[];
  } | null>(null);

  // Data hook
  const {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  } = useUsageData();

  useHeaderRefresh(loadUsage);

  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [customRange, setCustomRange] = useState<CustomRangeState>(loadCustomRange);
  const [initialFilterAnchorMs] = useState(() => Date.now());
  const startDateInputRef = useRef<HTMLInputElement | null>(null);
  const startTimeInputRef = useRef<HTMLInputElement | null>(null);
  const endDateInputRef = useRef<HTMLInputElement | null>(null);
  const endTimeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const source = openaiCompatibilityConfig;

    providersApi
      .getOpenAIProviders()
      .then((providers) => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex({ source, providers: providers || [] });
      })
      .catch(() => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex(null);
      });

    return () => {
      cancelled = true;
    };
  }, [openaiCompatibilityConfig]);

  const openaiProviderState = openaiProvidersWithAuthIndex;
  const openaiProvidersForUsage =
    openaiProviderState && openaiProviderState.source === openaiCompatibilityConfig
      ? openaiProviderState.providers
      : (openaiCompatibilityConfig ?? []);

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey),
      })),
    [t]
  );

  const filterAnchorMs = lastRefreshedAt?.getTime() ?? initialFilterAnchorMs;
  const effectiveEndPoint = useMemo(
    () => buildCustomRangePointFromDate(new Date(filterAnchorMs)),
    [filterAnchorMs]
  );

  const customWindow = useMemo<UsageTimeWindow | undefined>(() => {
    if (timeRange !== 'custom') return undefined;
    const startMs = toCustomRangeTimestamp(customRange.start, 'start');
    const endMs = customRange.useCurrentEnd
      ? filterAnchorMs
      : toCustomRangeTimestamp(customRange.end, 'end');
    if (startMs === undefined && endMs === undefined) return undefined;
    return { startMs, endMs };
  }, [customRange, filterAnchorMs, timeRange]);

  const filteredUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, timeRange, filterAnchorMs, customWindow) : null),
    [customWindow, filterAnchorMs, timeRange, usage]
  );

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(CUSTOM_RANGE_STORAGE_KEY, JSON.stringify(customRange));
    } catch {
      // Ignore storage errors.
    }
  }, [customRange]);

  const nowMs = lastRefreshedAt?.getTime() ?? 0;

  // Sparklines hook (依旧给 StatCards 的迷你趋势用，基于过滤后的数据)
  const { requestsSparkline, tokensSparkline, rpmSparkline, tpmSparkline, costSparkline } =
    useSparklines({ usage: filteredUsage, loading, nowMs });

  // Derived data (全部基于 filteredUsage)
  const apiStats = useMemo(
    () => getApiStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );
  const modelStats = useMemo(
    () => getModelStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );
  const hasPrices = Object.keys(modelPrices).length > 0;

  const handleSetCustomToNow = useCallback(
    (field: 'start' | 'end') => {
      setCustomRange((prev) => ({
        ...prev,
        [field]: buildCustomRangePointFromDate(new Date()),
      }));
    },
    []
  );

  const handleUseCurrentEndChange = useCallback(
    (checked: boolean) => {
      setCustomRange((prev) => ({
        ...prev,
        useCurrentEnd: checked,
        ...(!checked && !prev.end.date ? { end: buildCustomRangePointFromDate(new Date()) } : {}),
      }));
    },
    []
  );

  const handleClearCustom = useCallback(() => {
    setCustomRange(EMPTY_CUSTOM_RANGE);
  }, []);

  const handleCustomRangePartChange = useCallback(
    (field: 'start' | 'end', part: 'date' | 'time', value: string) => {
      setCustomRange((prev) => ({
        ...prev,
        [field]: {
          ...prev[field],
          [part]: value,
          ...(part === 'date' && !value ? { time: '' } : {}),
        },
      }));
    },
    []
  );

  const isSameCustomRangeDate =
    Boolean(customRange.start.date) &&
    customRange.start.date ===
      (customRange.useCurrentEnd ? effectiveEndPoint.date : customRange.end.date);

  const resolvedEndPoint = customRange.useCurrentEnd ? effectiveEndPoint : customRange.end;

  const openNativePicker = useCallback((ref: RefObject<HTMLInputElement | null>) => {
    const input = ref.current as PickerInputElement | null;
    if (!input || input.disabled) return;
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      // Fallback to focus only when showPicker is unsupported or blocked.
    }
  }, []);

  return (
    <div className={styles.container}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
            <Select
              value={timeRange}
              options={timeRangeOptions}
              onChange={(value) => setTimeRange(value as UsageTimeRange)}
              className={styles.timeRangeSelectControl}
              ariaLabel={t('usage_stats.range_filter')}
              fullWidth={false}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {timeRange === 'custom' && (
        <div className={styles.customRangePanel}>
          <section className={styles.customRangeFieldCard} aria-label={t('usage_stats.range_custom_start')}>
            <div className={styles.customRangeFieldHeader}>
              <div className={styles.customRangeFieldTitleWrap}>
                <span className={styles.customRangeLabel}>{t('usage_stats.range_custom_start')}</span>
              </div>
              <button
                type="button"
                className={styles.customRangeTextBtn}
                onClick={() => handleSetCustomToNow('start')}
              >
                {t('usage_stats.range_custom_now')}
              </button>
            </div>
            <div className={styles.customRangeInputRow}>
              <input
                ref={startDateInputRef}
                type="date"
                value={customRange.start.date}
                onChange={(e) => handleCustomRangePartChange('start', 'date', e.target.value)}
                onClick={() => openNativePicker(startDateInputRef)}
                className={styles.customRangeInput}
                max={resolvedEndPoint.date || undefined}
                aria-label={`${t('usage_stats.range_custom_start')} ${t('usage_stats.range_custom_date')}`}
              />
              <input
                ref={startTimeInputRef}
                type="time"
                value={customRange.start.time}
                onChange={(e) => handleCustomRangePartChange('start', 'time', e.target.value)}
                onClick={() => openNativePicker(startTimeInputRef)}
                className={`${styles.customRangeInput} ${styles.customRangeTimeInput}`}
                disabled={!customRange.start.date}
                step={60}
                max={
                  isSameCustomRangeDate && resolvedEndPoint.time ? resolvedEndPoint.time : undefined
                }
                aria-label={`${t('usage_stats.range_custom_start')} ${t('usage_stats.range_custom_clock')}`}
              />
            </div>
          </section>
          <section className={styles.customRangeFieldCard} aria-label={t('usage_stats.range_custom_end')}>
            <div className={styles.customRangeFieldHeader}>
              <div className={styles.customRangeFieldTitleWrap}>
                <span className={styles.customRangeLabel}>{t('usage_stats.range_custom_end')}</span>
                <span className={styles.customRangeMetaText}>
                  {t('usage_stats.range_custom_end_desc')}
                </span>
              </div>
              {!customRange.useCurrentEnd && (
                <button
                  type="button"
                  className={styles.customRangeTextBtn}
                  onClick={() => handleSetCustomToNow('end')}
                >
                  {t('usage_stats.range_custom_now')}
                </button>
              )}
            </div>
            <div className={styles.customRangeToggleRow}>
              <ToggleSwitch
                checked={customRange.useCurrentEnd}
                onChange={handleUseCurrentEndChange}
                label={t('usage_stats.range_custom_end_current')}
                ariaLabel={t('usage_stats.range_custom_end_current')}
              />
            </div>
            <div className={styles.customRangeInputRow}>
              <input
                ref={endDateInputRef}
                type="date"
                value={resolvedEndPoint.date}
                onChange={(e) => handleCustomRangePartChange('end', 'date', e.target.value)}
                onClick={() => openNativePicker(endDateInputRef)}
                className={styles.customRangeInput}
                disabled={customRange.useCurrentEnd}
                min={customRange.start.date || undefined}
                aria-label={`${t('usage_stats.range_custom_end')} ${t('usage_stats.range_custom_date')}`}
              />
              <input
                ref={endTimeInputRef}
                type="time"
                value={resolvedEndPoint.time}
                onChange={(e) => handleCustomRangePartChange('end', 'time', e.target.value)}
                onClick={() => openNativePicker(endTimeInputRef)}
                className={`${styles.customRangeInput} ${styles.customRangeTimeInput}`}
                disabled={customRange.useCurrentEnd || !customRange.end.date}
                step={60}
                min={
                  isSameCustomRangeDate && customRange.start.time
                    ? customRange.start.time
                    : undefined
                }
                aria-label={`${t('usage_stats.range_custom_end')} ${t('usage_stats.range_custom_clock')}`}
              />
            </div>
          </section>
          <div className={styles.customRangeActions}>
            <button
              type="button"
              className={styles.customRangeMiniBtn}
              onClick={handleClearCustom}
              disabled={
                !customRange.start.date &&
                !customRange.start.time &&
                customRange.useCurrentEnd &&
                !customRange.end.date &&
                !customRange.end.time
              }
            >
              {t('usage_stats.range_custom_clear')}
            </button>
          </div>
          {!customRange.start.date && !customRange.end.date && (
            <span className={styles.customRangeHint}>{t('usage_stats.range_custom_hint')}</span>
          )}
        </div>
      )}

      {error && <div className={styles.errorBox}>{error}</div>}

      {/* Stats Overview Cards */}
      <StatCards
        usage={filteredUsage}
        loading={loading}
        modelPrices={modelPrices}
        nowMs={nowMs}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline,
        }}
      />

      {/* Auth 文件统计：请求/成功/失败/Tokens/花费 */}
      <CredentialStatsCard
        usage={filteredUsage}
        loading={loading}
        modelPrices={modelPrices}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />

      {/* Details Grid */}
      <div className={styles.detailsGrid}>
        <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
        <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
      </div>

      <RequestEventsDetailsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />
    </div>
  );
}
