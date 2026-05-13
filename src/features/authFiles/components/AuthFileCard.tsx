import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconDownload, IconSettings, IconTrash2 } from '@/components/ui/icons';
import type { AuthFileItem } from '@/types';
import { useQuotaStore } from '@/stores';
import { resolveAuthProvider } from '@/utils/quota';
import { normalizeUsageTotal } from '@/utils/recentRequests';
import { formatQuotaResetTime } from '@/utils/quota/formatters';
import { parseTimestamp } from '@/utils/timestamp';
import {
  QUOTA_PROVIDER_TYPES,
  getAuthFileIcon,
  getAuthFileStatusMessage,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  parseDisableCoolingValue,
  parsePriorityValue,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFileCardProps = {
  file: AuthFileItem;
  compact: boolean;
  selected: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  quotaFilterType: QuotaProviderType | null;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  onShowModels: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onOpenPrefixProxyEditor: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
};

const resolveQuotaType = (file: AuthFileItem): QuotaProviderType | null => {
  const provider = resolveAuthProvider(file);
  if (!QUOTA_PROVIDER_TYPES.has(provider as QuotaProviderType)) return null;
  return provider as QuotaProviderType;
};

const formatPercent = (value: number): string => `${value.toFixed(1).replace(/\.0$/, '')}%`;

const padDatePart = (value: number): string => String(value).padStart(2, '0');

const formatDateTime = (date: Date): string => {
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  const seconds = padDatePart(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

const formatUnixSecondsDateTime = (value: number): string => {
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? '' : formatDateTime(date);
};

const getUsageLimitResetTimeLabel = (rawStatusMessage: string): string => {
  if (!rawStatusMessage) return '';

  try {
    const parsed = JSON.parse(rawStatusMessage) as unknown;
    if (!parsed || typeof parsed !== 'object') return '';

    const root = parsed as Record<string, unknown>;
    const error =
      root.error && typeof root.error === 'object'
        ? (root.error as Record<string, unknown>)
        : root;
    const errorType = typeof error.type === 'string' ? error.type.trim() : '';

    if (errorType !== 'usage_limit_reached') return '';

    const resetsAtRaw = error.resets_at ?? error.resetsAt;
    const resetsAt =
      typeof resetsAtRaw === 'number'
        ? resetsAtRaw
        : typeof resetsAtRaw === 'string'
          ? Number(resetsAtRaw.trim())
          : Number.NaN;

    if (!Number.isFinite(resetsAt) || resetsAt <= 0) return '';
    return formatUnixSecondsDateTime(resetsAt);
  } catch {
    return '';
  }
};

const formatResetValue = (value: unknown): string => {
  if (value == null) return '';

  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleString(undefined, {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
  }

  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) {
    return formatResetValue(numericValue);
  }

  const parsed = parseTimestamp(trimmed);
  if (parsed) {
    return parsed.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  return trimmed;
};

const getQuotaResetLabel = (quotaType: QuotaProviderType | null, quotaEntry: unknown): string => {
  if (!quotaType || !quotaEntry || typeof quotaEntry !== 'object') return '';

  if (quotaType === 'antigravity') {
    const groups = Array.isArray((quotaEntry as { groups?: Array<{ resetTime?: string }> }).groups)
      ? (quotaEntry as { groups: Array<{ resetTime?: string }> }).groups
      : [];
    return (
      groups
        .map((group) => formatQuotaResetTime(group.resetTime))
        .find((value) => value && value !== '-') || ''
    );
  }

  if (quotaType === 'codex' || quotaType === 'claude') {
    const windows = Array.isArray(
      (quotaEntry as { windows?: Array<{ resetLabel?: string }> }).windows
    )
      ? (quotaEntry as { windows: Array<{ resetLabel?: string }> }).windows
      : [];
    return (
      windows
        .map((window) => (typeof window.resetLabel === 'string' ? window.resetLabel.trim() : ''))
        .find((value) => value && value !== '-') || ''
    );
  }

  if (quotaType === 'gemini-cli') {
    const buckets = Array.isArray(
      (quotaEntry as { buckets?: Array<{ resetTime?: string }> }).buckets
    )
      ? (quotaEntry as { buckets: Array<{ resetTime?: string }> }).buckets
      : [];
    return (
      buckets
        .map((bucket) => formatQuotaResetTime(bucket.resetTime))
        .find((value) => value && value !== '-') || ''
    );
  }

  if (quotaType === 'kimi') {
    const rows = Array.isArray((quotaEntry as { rows?: Array<{ resetHint?: string }> }).rows)
      ? (quotaEntry as { rows: Array<{ resetHint?: string }> }).rows
      : [];
    return (
      rows
        .map((row) => (typeof row.resetHint === 'string' ? row.resetHint.trim() : ''))
        .find(Boolean) || ''
    );
  }

  return '';
};

const getResetTimeLabel = (
  file: AuthFileItem,
  quotaType: QuotaProviderType | null,
  quotaEntry: unknown,
  rawStatusMessage: string
): string => {
  const usageLimitResetLabel = getUsageLimitResetTimeLabel(rawStatusMessage);
  if (usageLimitResetLabel) return usageLimitResetLabel;

  const quotaLabel = getQuotaResetLabel(quotaType, quotaEntry);
  if (quotaLabel) return quotaLabel;

  const candidates = [
    file.resetTime,
    file['reset_time'],
    file.resetAt,
    file['reset_at'],
    file['quota_reset_time'],
    file['quotaResetTime'],
  ];

  for (const candidate of candidates) {
    const formatted = formatResetValue(candidate);
    if (formatted) return formatted;
  }

  return '-';
};

export function AuthFileCard(props: AuthFileCardProps) {
  const { t } = useTranslation();
  const {
    file,
    compact,
    selected,
    resolvedTheme,
    disableControls,
    deleting,
    statusUpdating,
    onDownload,
    onOpenPrefixProxyEditor,
    onDelete,
    onToggleStatus,
    onToggleSelect,
  } = props;

  const fileStats = {
    success: normalizeUsageTotal(file.success),
    failure: normalizeUsageTotal(file.failed),
  };
  const totalRequests = fileStats.success + fileStats.failure;
  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const typeColor = getTypeColor(file.type || 'unknown', resolvedTheme);
  const typeLabel = getTypeLabel(t, file.type || 'unknown');
  const providerIcon = getAuthFileIcon(file.type || 'unknown', resolvedTheme);
  const quotaType = resolveQuotaType(file);
  const providerCardClass =
    quotaType === 'antigravity'
      ? styles.antigravityCard
      : quotaType === 'claude'
        ? styles.claudeCard
        : quotaType === 'codex'
          ? styles.codexCard
          : quotaType === 'gemini-cli'
            ? styles.geminiCliCard
            : quotaType === 'kimi'
              ? styles.kimiCard
              : '';
  const rawStatusMessage = getAuthFileStatusMessage(file);
  const priorityValue = parsePriorityValue(file.priority ?? file['priority']);
  const disableCoolingValue = parseDisableCoolingValue(
    file.disable_cooling ?? file['disable_cooling'] ?? file['disable-cooling']
  );
  const noteValue = typeof file.note === 'string' ? file.note.trim() : '';
  const successRateLabel =
    totalRequests > 0 ? formatPercent((fileStats.success / totalRequests) * 100) : '-';
  const stateLabel = isRuntimeOnly
    ? t('auth_files.type_virtual')
    : file.disabled
      ? t('auth_files.health_status_disabled')
      : rawStatusMessage
        ? t('auth_files.health_status_warning')
        : t('auth_files.health_status_healthy');
  const stateBadgeClass = isRuntimeOnly
    ? styles.stateBadgeVirtual
    : file.disabled
      ? styles.stateBadgeDisabled
      : rawStatusMessage
        ? styles.stateBadgeWarning
        : styles.stateBadgeActive;
  const quotaEntry = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name];
    if (quotaType === 'claude') return state.claudeQuota[file.name];
    if (quotaType === 'codex') return state.codexQuota[file.name];
    if (quotaType === 'gemini-cli') return state.geminiCliQuota[file.name];
    if (quotaType === 'kimi') return state.kimiQuota[file.name];
    return undefined;
  });
  const resetTimeLabel = getResetTimeLabel(file, quotaType, quotaEntry, rawStatusMessage);
  const disableCoolingLabel =
    disableCoolingValue === undefined
      ? '-'
      : disableCoolingValue
        ? t('common.yes')
        : t('common.no');

  return (
    <div
      className={`${styles.fileCard} ${compact ? styles.fileCardCompact : ''} ${providerCardClass} ${selected ? styles.fileCardSelected : ''} ${file.disabled ? styles.fileCardDisabled : ''}`}
    >
      <div className={styles.authListRow}>
        <div className={styles.recordLine}>
          <div className={`${styles.recordField} ${styles.recordFieldName}`}>
            {!isRuntimeOnly && (
              <SelectionCheckbox
                checked={selected}
                onChange={() => onToggleSelect(file.name)}
                className={styles.cardSelection}
                aria-label={
                  selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                }
                title={selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')}
              />
            )}
            <div
              className={styles.providerAvatar}
              style={{
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                ...(typeColor.border ? { border: typeColor.border } : {}),
              }}
            >
              {providerIcon ? (
                <img src={providerIcon} alt="" className={styles.providerAvatarImage} />
              ) : (
                <span className={styles.providerAvatarFallback}>
                  {typeLabel.slice(0, 1).toUpperCase()}
                </span>
              )}
            </div>
            <div className={styles.fileIdentity}>
              <div className={styles.cardBadgeRow}>
                <span
                  className={styles.typeBadge}
                  style={{
                    backgroundColor: typeColor.bg,
                    color: typeColor.text,
                    ...(typeColor.border ? { border: typeColor.border } : {}),
                  }}
                >
                  {typeLabel}
                </span>
                <span className={`${styles.stateBadge} ${stateBadgeClass}`}>{stateLabel}</span>
              </div>
              <span className={styles.fileName} title={file.name}>
                {file.name}
              </span>
            </div>
          </div>

          <div className={styles.recordField}>
            <span className={styles.recordLabel}>{t('auth_files.disable_cooling_list')}</span>
            <span className={styles.recordValue}>{disableCoolingLabel}</span>
          </div>

          <div className={styles.recordField}>
            <span className={styles.recordLabel}>{t('auth_files.priority_display')}</span>
            <span className={`${styles.recordValue} ${styles.priorityValue}`}>
              {priorityValue ?? '-'}
            </span>
          </div>

          <div className={styles.recordField}>
            <span className={styles.recordLabel}>{t('auth_files.usage_display')}</span>
            <span className={styles.recordValue}>
              {fileStats.success}/{fileStats.failure}
            </span>
          </div>

          <div className={styles.recordField}>
            <span className={styles.recordLabel}>{t('usage_stats.success_rate')}</span>
            <span className={styles.recordValue}>{successRateLabel}</span>
          </div>

          <div className={styles.recordField}>
            <span className={styles.recordLabel}>{t('auth_files.note_display')}</span>
            <span className={styles.recordValue} title={noteValue || undefined}>
              {noteValue || '-'}
            </span>
          </div>

          <div className={styles.recordField}>
            <span className={styles.recordLabel}>{t('auth_files.reset_time_display')}</span>
            <span className={styles.recordValue}>{resetTimeLabel}</span>
          </div>

          <div className={`${styles.recordField} ${styles.recordFieldActions}`}>
            <span className={styles.recordLabel}>{t('auth_files.operations_display')}</span>
            {isRuntimeOnly ? (
              <span className={styles.recordValue}>-</span>
            ) : (
              <div className={styles.recordActions}>
                <div className={styles.statusToggleInline}>
                  <ToggleSwitch
                    ariaLabel={t('auth_files.status_toggle_label')}
                    checked={!file.disabled}
                    disabled={disableControls || statusUpdating[file.name] === true}
                    onChange={(value) => onToggleStatus(file, value)}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenPrefixProxyEditor(file)}
                  className={styles.iconButton}
                  title={t('auth_files.prefix_proxy_button')}
                  disabled={disableControls}
                >
                  <IconSettings className={styles.actionIcon} size={16} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDownload(file.name)}
                  className={styles.iconButton}
                  title={t('auth_files.download_button')}
                  disabled={disableControls}
                >
                  <IconDownload className={styles.actionIcon} size={16} />
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onDelete(file.name)}
                  className={styles.iconButton}
                  title={t('auth_files.delete_button')}
                  disabled={disableControls || deleting === file.name}
                >
                  {deleting === file.name ? (
                    <LoadingSpinner size={14} />
                  ) : (
                    <IconTrash2 className={styles.actionIcon} size={16} />
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>

        <div
          className={`${styles.errorLine} ${rawStatusMessage ? styles.errorLineWarning : ''}`}
          title={rawStatusMessage || undefined}
        >
          <span className={styles.errorLabel}>{t('auth_files.error_message_display')}</span>
          <span className={styles.errorValue}>{rawStatusMessage || '-'}</span>
        </div>
      </div>
    </div>
  );
}
