import { useState, useMemo, useCallback, useEffect } from 'react';
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
const DEFAULT_TIME_RANGE: UsageTimeRange = '24h';
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: 'all', labelKey: 'usage_stats.range_all' },
  { value: '7h', labelKey: 'usage_stats.range_7h' },
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: 'custom', labelKey: 'usage_stats.range_custom' },
];

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '7h' ||
  value === '24h' ||
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

interface CustomRangeState {
  start: string;
  end: string;
}

const EMPTY_CUSTOM_RANGE: CustomRangeState = { start: '', end: '' };

const loadCustomRange = (): CustomRangeState => {
  try {
    if (typeof localStorage === 'undefined') return EMPTY_CUSTOM_RANGE;
    const raw = localStorage.getItem(CUSTOM_RANGE_STORAGE_KEY);
    if (!raw) return EMPTY_CUSTOM_RANGE;
    const parsed = JSON.parse(raw) as Partial<CustomRangeState>;
    return {
      start: typeof parsed.start === 'string' ? parsed.start : '',
      end: typeof parsed.end === 'string' ? parsed.end : '',
    };
  } catch {
    return EMPTY_CUSTOM_RANGE;
  }
};

const parseDatetimeLocal = (value: string): number | undefined => {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : undefined;
};

const toDatetimeLocal = (date: Date): string => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
};

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

  const customWindow = useMemo<UsageTimeWindow | undefined>(() => {
    if (timeRange !== 'custom') return undefined;
    const startMs = parseDatetimeLocal(customRange.start);
    const endMs = parseDatetimeLocal(customRange.end);
    if (startMs === undefined && endMs === undefined) return undefined;
    return { startMs, endMs };
  }, [timeRange, customRange]);

  const filteredUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, timeRange, Date.now(), customWindow) : null),
    [usage, timeRange, customWindow]
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
      const now = new Date();
      setCustomRange((prev) => ({ ...prev, [field]: toDatetimeLocal(now) }));
    },
    []
  );

  const handleClearCustom = useCallback(() => {
    setCustomRange(EMPTY_CUSTOM_RANGE);
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
          <label className={styles.customRangeField}>
            <span className={styles.customRangeLabel}>{t('usage_stats.range_custom_start')}</span>
            <input
              type="datetime-local"
              value={customRange.start}
              onChange={(e) => setCustomRange((prev) => ({ ...prev, start: e.target.value }))}
              className={styles.customRangeInput}
              max={customRange.end || undefined}
            />
            <button
              type="button"
              className={styles.customRangeMiniBtn}
              onClick={() => handleSetCustomToNow('start')}
            >
              {t('usage_stats.range_custom_now')}
            </button>
          </label>
          <label className={styles.customRangeField}>
            <span className={styles.customRangeLabel}>{t('usage_stats.range_custom_end')}</span>
            <input
              type="datetime-local"
              value={customRange.end}
              onChange={(e) => setCustomRange((prev) => ({ ...prev, end: e.target.value }))}
              className={styles.customRangeInput}
              min={customRange.start || undefined}
            />
            <button
              type="button"
              className={styles.customRangeMiniBtn}
              onClick={() => handleSetCustomToNow('end')}
            >
              {t('usage_stats.range_custom_now')}
            </button>
          </label>
          <button
            type="button"
            className={styles.customRangeMiniBtn}
            onClick={handleClearCustom}
            disabled={!customRange.start && !customRange.end}
          >
            {t('usage_stats.range_custom_clear')}
          </button>
          {!customRange.start && !customRange.end && (
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
