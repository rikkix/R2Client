import { InfoCircleOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons';
import type { FolderNotice } from '@/app/lib/folderNotice';

export default function FolderStatus({
  notice,
  onRetry,
}: {
  notice?: FolderNotice | null;
  onRetry?: () => void;
}) {
  return (
    <div
      className={`sb-folder-status${notice ? ` ${notice.tone}` : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {notice && (
        <>
          {notice.tone === 'progress' ? (
            <SyncOutlined spin />
          ) : notice.tone === 'error' ? (
            <WarningOutlined />
          ) : (
            <InfoCircleOutlined />
          )}
          <span className="sb-folder-message" title={notice.detail ?? notice.label}>
            {notice.label}
          </span>
          {notice.retry && onRetry && (
            <button type="button" className="sb-folder-retry" onClick={onRetry}>
              Retry
            </button>
          )}
        </>
      )}
    </div>
  );
}
