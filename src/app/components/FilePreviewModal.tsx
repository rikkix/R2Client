'use client';
import { usePreviewUrl } from '@/app/hooks/usePreviewUrl';
import { usePreviewKind } from '@/app/hooks/usePreviewKind';
import { TEXT_PREVIEW_LIMIT, type PreviewKind } from '@/app/lib/previewType';
import { useObjectActionStore } from '@/app/stores/objectActionStore';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Image, App } from 'antd';
import {
  LinkOutlined,
  CopyOutlined,
  CloseOutlined,
  FileOutlined,
  FileImageOutlined,
  PlaySquareOutlined,
  SoundOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { openUrl } from '@tauri-apps/plugin-opener';
import dynamic from 'next/dynamic';
import {
  buildPublicUrl,
  hasSigningCredentials,
  uploadContent,
  isBucketPublic,
  StorageConfig,
} from '@/app/lib/r2cache';
import { TEXT_EXTENSIONS } from '@/app/components/preview/TextViewer';
import { useVideoThumbnail } from '@/app/hooks/useVideoThumbnail';
import { usePreviewStore } from '@/app/stores/previewStore';
import Modal from '@/app/components/ui/Modal';

const PDFViewer = dynamic(() => import('@/app/components/preview/PDFViewer'), { ssr: false });
const TextViewer = dynamic(() => import('@/app/components/preview/TextViewer'), { ssr: false });

const TEXT_CONTENT_TYPES: Record<string, string> = {
  js: 'application/javascript',
  ts: 'application/typescript',
  jsx: 'text/jsx',
  tsx: 'text/tsx',
  css: 'text/css',
  scss: 'text/x-scss',
  less: 'text/x-less',
  html: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  toml: 'text/x-toml',
  md: 'text/markdown',
  markdown: 'text/markdown',
  sql: 'text/x-sql',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  ini: 'text/x-ini',
  env: 'text/plain',
};

function getExt(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

function getContentType(filename: string): string {
  return TEXT_CONTENT_TYPES[getExt(filename)] || 'text/plain';
}

function isTextFile(f: string) {
  return TEXT_EXTENSIONS.includes(getExt(f));
}

function fileTypeIcon(kind: PreviewKind, size = 18): React.ReactNode {
  if (kind === 'image') return <FileImageOutlined style={{ fontSize: size }} />;
  if (kind === 'video') return <PlaySquareOutlined style={{ fontSize: size }} />;
  if (kind === 'audio') return <SoundOutlined style={{ fontSize: size }} />;
  if (kind === 'pdf') return <FilePdfOutlined style={{ fontSize: size }} />;
  if (kind === 'text') return <FileTextOutlined style={{ fontSize: size }} />;
  return <FileOutlined style={{ fontSize: size }} />;
}

interface FilePreviewModalProps {
  config?: StorageConfig | null;
  onCredentialsUpdate?: () => void;
  onFileUpdated?: () => void;
}

export default function FilePreviewModal({ config, onFileUpdated }: FilePreviewModalProps) {
  const { message } = App.useApp();
  const { file, files, close, navigate } = usePreviewStore();
  const isOpen = !!file;
  const openAction = useObjectActionStore((state) => state.open);
  const objectActionOpen = useObjectActionStore((state) => !!state.action);
  const fileUrl = usePreviewUrl(config, file?.key ?? '', !!file);
  const { kind, detecting, error: detectionError } = usePreviewKind(fileUrl, file?.name ?? '');
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateSize = () =>
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const previewableFiles = useMemo(() => files.filter((f) => !f.isFolder), [files]);
  const currentIndex = useMemo(
    () => (file ? previewableFiles.findIndex((f) => f.key === file.key) : -1),
    [file, previewableFiles]
  );

  // Keyboard navigation: arrow keys to switch files
  useEffect(() => {
    if (!isOpen || objectActionOpen || previewableFiles.length <= 1) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate('prev');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigate('next');
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const isScrollable =
          tag === 'PRE' ||
          tag === 'CODE' ||
          (e.target as HTMLElement)?.closest?.('[data-scrollable]');
        if (!isScrollable) {
          e.preventDefault();
          navigate(e.key === 'ArrowUp' ? 'prev' : 'next');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, objectActionOpen, previewableFiles.length, navigate]);

  const hasCredentials = hasSigningCredentials(config);
  const isPublic = isBucketPublic(config);
  const needsCredentials = !isPublic && !hasCredentials;
  const canEdit = !!(config?.bucket && hasCredentials);

  const handleSaveContent = useCallback(
    async (content: string) => {
      if (!file || !config || !hasCredentials) throw new Error('Missing credentials or file info');
      try {
        await uploadContent(config, file.key, content, getContentType(file.name));
        message.success('File saved successfully');
        onFileUpdated?.();
      } catch (err) {
        message.error('Failed to save file');
        throw err;
      }
    },
    [file, config, hasCredentials, message, onFileUpdated]
  );

  const isImage = kind === 'image';
  const isVideo = kind === 'video';
  const isAudio = kind === 'audio';
  const isPdf = kind === 'pdf';
  const isText = kind === 'text';
  const detectedText = isText && !!file && !isTextFile(file.name);
  const textTooLarge = isText && (file?.size ?? 0) > TEXT_PREVIEW_LIMIT;
  const { thumbnailSrc: videoPoster } = useVideoThumbnail(isVideo ? fileUrl : null);
  const publicUrl = file && config && isPublic ? buildPublicUrl(config, file.key) : null;
  if (!file) return null;
  function generateLink() {
    if (config && file) openAction({ kind: 'signed-url', config, key: file.key, name: file.name });
  }
  const getModalWidth = () => {
    const width = windowSize.width || (typeof window !== 'undefined' ? window.innerWidth : 1024);
    if (width < 640) return '95%';
    if (width < 1024) return '90%';
    return 1100;
  };

  const getPreviewMaxHeight = () => {
    const height = windowSize.height || (typeof window !== 'undefined' ? window.innerHeight : 768);
    return `${Math.min(height * 0.55, 700)}px`;
  };

  async function handleCopyUrl() {
    if (!publicUrl) {
      message.warning('No public domain configured');
      return;
    }
    try {
      await navigator.clipboard.writeText(publicUrl);
      message.success('URL copied to clipboard');
    } catch {
      message.error('Failed to copy URL');
    }
  }

  async function handleOpenUrl() {
    if (!publicUrl) {
      message.warning('No public domain configured');
      return;
    }
    try {
      await openUrl(publicUrl);
    } catch {
      message.error('Failed to open URL');
    }
  }

  // Build file size + modified subtitle
  const fileSizeStr = file.size
    ? file.size < 1024
      ? `${file.size} B`
      : file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`
    : null;
  const modifiedStr = file.lastModified
    ? new Date(file.lastModified).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;
  const subtitle = [fileSizeStr, modifiedStr].filter(Boolean).join(' · ') || undefined;

  // Navigation counter
  const navCounter =
    previewableFiles.length > 1 ? `${currentIndex + 1} / ${previewableFiles.length}` : undefined;

  const footer = (
    <>
      {/* Left: copy URL */}
      <span className="left" style={{ display: 'flex', gap: 6 }}>
        {!isPublic && (
          <button className="btn" onClick={generateLink} disabled={!hasCredentials}>
            Generate signed URL
          </button>
        )}
        <button className="btn" onClick={handleOpenUrl} disabled={!publicUrl}>
          <LinkOutlined /> Open URL
        </button>
        <button className="btn" onClick={handleCopyUrl} disabled={!publicUrl}>
          <CopyOutlined /> Copy URL
        </button>
      </span>

      {/* Navigation */}
      {previewableFiles.length > 1 && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn" onClick={() => navigate('prev')} style={{ padding: '0 10px' }}>
            <LeftOutlined />
          </button>
          <span
            style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 48, textAlign: 'center' }}
          >
            {navCounter}
          </span>
          <button className="btn" onClick={() => navigate('next')} style={{ padding: '0 10px' }}>
            <RightOutlined />
          </button>
        </span>
      )}

      <button className="btn btn-primary" onClick={close}>
        <CloseOutlined /> Close
      </button>
    </>
  );

  const modalWidth = getModalWidth();

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title={file.name}
      subtitle={subtitle}
      icon={fileTypeIcon(kind)}
      width={typeof modalWidth === 'number' ? modalWidth : undefined}
      footer={footer}
    >
      {/* Preview area */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        {detecting ? (
          <p>Detecting preview type…</p>
        ) : detectionError ? (
          <p role="alert">{detectionError}</p>
        ) : textTooLarge ? (
          <p>Text preview is limited to 5 MiB. Download this file to view it.</p>
        ) : isImage && fileUrl ? (
          <Image
            src={fileUrl}
            alt={file.name}
            style={{ maxHeight: getPreviewMaxHeight(), maxWidth: '100%', objectFit: 'contain' }}
          />
        ) : isVideo && fileUrl ? (
          <video
            src={fileUrl}
            controls
            preload="metadata"
            poster={videoPoster ?? undefined}
            playsInline
            style={{
              display: 'block',
              margin: '0 auto',
              maxWidth: '100%',
              maxHeight: getPreviewMaxHeight(),
              borderRadius: 8,
            }}
          />
        ) : isAudio && fileUrl ? (
          <audio src={fileUrl} controls style={{ width: '100%' }} />
        ) : isPdf && fileUrl ? (
          <PDFViewer url={fileUrl} showControls maxHeight={getPreviewMaxHeight()} />
        ) : isText && fileUrl ? (
          <TextViewer
            key={fileUrl}
            url={fileUrl}
            filename={file.name}
            maxHeight={getPreviewMaxHeight()}
            editable={canEdit && !detectedText}
            maxBytes={TEXT_PREVIEW_LIMIT}
            onSave={handleSaveContent}
          />
        ) : isImage ? (
          <FileImageOutlined style={{ fontSize: 40, color: 'var(--accent)' }} />
        ) : isVideo ? (
          <PlaySquareOutlined style={{ fontSize: 40, color: 'var(--accent)' }} />
        ) : isAudio ? (
          <SoundOutlined style={{ fontSize: 40, color: 'var(--accent)' }} />
        ) : isPdf ? (
          <FilePdfOutlined style={{ fontSize: 40, color: 'var(--accent)' }} />
        ) : isText ? (
          <FileTextOutlined style={{ fontSize: 40, color: 'var(--accent)' }} />
        ) : (
          <>
            <FileOutlined style={{ fontSize: 40, color: 'var(--accent)' }} />
            {fileUrl && <p>No supported preview detected for this file.</p>}
          </>
        )}
      </div>

      {/* URL display */}
      {publicUrl ? (
        <div
          style={{
            background: 'var(--bg-sunken)',
            padding: '10px 14px',
            borderRadius: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 11.5,
            color: 'var(--text-muted)',
            wordBreak: 'break-all',
            lineHeight: 1.5,
          }}
        >
          {publicUrl}
        </div>
      ) : needsCredentials ? (
        <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
          S3 credentials required for private previews. Configure in Account Settings.
        </p>
      ) : (
        <p style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>
          {isPublic
            ? 'No public URL configured'
            : fileUrl
              ? 'Private preview uses authenticated access. Generate a signed URL only when you want to share this file.'
              : 'Loading private preview…'}
        </p>
      )}
    </Modal>
  );
}
