'use client';
import { useEffect, useState } from 'react';
import { App, Input, Spin } from 'antd';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useQueryClient } from '@tanstack/react-query';
import Modal from '@/app/components/ui/Modal';
import { useObjectActionStore, type ObjectAction } from '@/app/stores/objectActionStore';
import { useObjectRevisionStore } from '@/app/stores/objectRevisionStore';
import { generateSignedUrl } from '@/app/lib/r2cache';
import { validateSignedUrlLifetime } from '@/app/lib/signedUrl';
import { metadataChanges, METADATA_HEADERS, METADATA_COPY_LIMIT } from '@/app/lib/objectMetadata';
import { getProviderAdapter } from '@/app/providers/index';
import type { ObjectMetadata, StorageConfig } from '@/app/providers/types';
import { formatBytes } from '@/app/utils/formatBytes';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
const fieldStyle = { display: 'grid', gap: 6, marginBottom: 12 } as const;

export default function ObjectActions({ config }: { config: StorageConfig | null | undefined }) {
  const { action, close } = useObjectActionStore();
  const scope = JSON.stringify(config);
  useEffect(() => {
    if (action && JSON.stringify(action.config) !== scope) close();
  }, [action, close, scope]);
  if (!action || JSON.stringify(action.config) !== scope) return null;
  return action.kind === 'signed-url' ? (
    <SignedUrlDialog action={action} close={close} />
  ) : (
    <MetadataDialog action={action} close={close} />
  );
}

function SignedUrlDialog({ action, close }: { action: ObjectAction; close: () => void }) {
  const { message } = App.useApp();
  const [selection, setSelection] = useState('');
  const [custom, setCustom] = useState('');
  const [unit, setUnit] = useState(1);
  const [result, setResult] = useState<{ url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  let lifetime: number | null = null;
  try {
    lifetime = validateSignedUrlLifetime(
      selection === 'custom' ? Number(custom) * unit : Number(selection)
    );
  } catch {
    /* Selection is required. */
  }
  async function generate() {
    if (lifetime === null || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const startedAt = Date.now();
      const url = await generateSignedUrl(action.config, action.key, lifetime);
      setResult({ url, expiresAt: startedAt + lifetime * 1000 });
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const expired = !!result && result.expiresAt <= now;
  return (
    <Modal
      open
      onClose={close}
      title="Generate signed URL"
      subtitle={action.name}
      width={620}
      zIndex={1500}
      footer={
        <>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void generate()}
            disabled={lifetime === null || busy}
          >
            {busy ? 'Generating…' : 'Generate signed URL'}
          </button>
        </>
      }
    >
      <label style={fieldStyle}>
        Lifetime{' '}
        <select
          className="btn"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
          aria-label="Lifetime"
        >
          <option value="" disabled>
            Choose a lifetime
          </option>
          <option value="900">15 minutes</option>
          <option value="3600">1 hour</option>
          <option value="86400">24 hours</option>
          <option value="604800">7 days</option>
          <option value="custom">Custom duration</option>
        </select>
      </label>
      {selection === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            aria-label="Custom duration"
            type="number"
            min={1}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
          <select
            className="btn"
            aria-label="Duration unit"
            value={unit}
            onChange={(event) => setUnit(Number(event.target.value))}
          >
            <option value={1}>Seconds</option>
            <option value={60}>Minutes</option>
            <option value={3600}>Hours</option>
            <option value={86400}>Days</option>
          </select>
        </div>
      )}
      <p style={{ color: 'var(--text-muted)' }}>
        Choose between 1 second and 7 days. Anyone with this link can read the file until it
        expires.
      </p>
      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      {result && (
        <div>
          <Input.TextArea
            aria-label="Generated signed URL"
            readOnly
            value={result.url}
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
          <p>
            {expired ? 'Expired' : 'Expires'}: {new Date(result.expiresAt).toLocaleString()}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              disabled={expired}
              onClick={() =>
                void navigator.clipboard
                  .writeText(result.url)
                  .then(() => message.success('Signed URL copied'))
                  .catch(() => message.error('Could not copy URL'))
              }
            >
              Copy URL
            </button>
            <button
              className="btn"
              disabled={expired}
              onClick={() =>
                void openUrl(result.url).catch(() => message.error('Could not open URL'))
              }
            >
              Open URL
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MetadataDialog({ action, close }: { action: ObjectAction; close: () => void }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const bump = useObjectRevisionStore((state) => state.bump);
  const [baseline, setBaseline] = useState<ObjectMetadata | null>(null);
  const [headers, setHeaders] = useState<Record<string, string | null>>({});
  const [entries, setEntries] = useState<[string, string][]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBaseline(null);
    void getProviderAdapter(action.config)
      .getObjectMetadata(action.config, action.key)
      .then((metadata) => {
        if (cancelled) return;
        setBaseline(metadata);
        setHeaders(metadata.headers);
        setEntries(Object.entries(metadata.customMetadata));
        setMustReload(false);
      })
      .catch((error: unknown) => {
        if (!cancelled) setError(errorText(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [action, reload]);
  let changes: ReturnType<typeof metadataChanges> | null = null;
  let validationError: string | null = null;
  if (baseline) {
    try {
      changes = metadataChanges(baseline, headers, entries, action.config.provider);
    } catch (error) {
      validationError = errorText(error);
    }
  }
  const changed =
    !!changes &&
    (Object.keys(changes.headers).length > 0 || Object.keys(changes.customMetadata).length > 0);
  const blocked =
    baseline &&
    (baseline.size > METADATA_COPY_LIMIT
      ? 'Metadata editing is limited to objects up to 5 GiB.'
      : baseline.missingMetadata > 0
        ? 'Some metadata is omitted by the S3 API. Editing is disabled to avoid losing it.'
        : null);
  async function save() {
    if (!baseline || !changes || !changed || saving || blocked || mustReload) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await getProviderAdapter(action.config).updateObjectMetadata(
        action.config,
        action.key,
        baseline,
        changes
      );
      setBaseline(updated);
      setHeaders(updated.headers);
      setEntries(Object.entries(updated.customMetadata));
      bump();
      await queryClient.invalidateQueries({ queryKey: ['object-metadata'] });
      message.success('Metadata saved and verified');
    } catch (error) {
      const text = errorText(error);
      setError(text);
      if (/conflict:|outcome_unknown:|verification_failed:/.test(text)) {
        setMustReload(true);
        bump();
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!saving) close();
      }}
      title="Edit metadata"
      subtitle={action.name}
      width={720}
      zIndex={1500}
      footer={
        <>
          <button
            className="btn"
            onClick={() => setReload((value) => value + 1)}
            disabled={loading || saving}
          >
            Reload metadata
          </button>
          <button className="btn" onClick={close} disabled={saving}>
            Close
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={!changed || !!validationError || !!blocked || loading || saving || mustReload}
          >
            {saving ? 'Saving…' : 'Save metadata'}
          </button>
        </>
      }
    >
      {loading ? (
        <Spin />
      ) : (
        baseline && (
          <>
            <div style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
              Size: {formatBytes(baseline.size)} · Storage class: {baseline.storageClass}
              <br />
              ETag: {baseline.etag}
              <br />
              Modified: {baseline.lastModified ?? '—'}
            </div>
            {blocked && (
              <p role="alert" style={{ color: 'var(--danger)' }}>
                {blocked}
              </p>
            )}
            <fieldset disabled={!!blocked || saving} style={{ border: 0, padding: 0, margin: 0 }}>
              {METADATA_HEADERS.map((header) => (
                <label key={header} style={fieldStyle}>
                  {header}
                  <Input
                    aria-label={header}
                    value={headers[header] ?? ''}
                    placeholder={
                      header === 'Expires'
                        ? 'HTTP date or ISO 8601 timestamp'
                        : header === 'Content-Type'
                          ? 'application/octet-stream when cleared'
                          : 'Not set'
                    }
                    onChange={(event) =>
                      setHeaders((current) => ({
                        ...current,
                        [header]: event.target.value || null,
                      }))
                    }
                  />
                </label>
              ))}
              <p style={{ color: 'var(--text-muted)' }}>Custom metadata</p>
              {entries.map(([key, value], index) => (
                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <Input
                    aria-label={`Metadata key ${index + 1}`}
                    placeholder="Key"
                    value={key}
                    onChange={(event) =>
                      setEntries((current) =>
                        current.map((entry, i) =>
                          i === index ? [event.target.value, entry[1]] : entry
                        )
                      )
                    }
                  />
                  <Input
                    aria-label={`Metadata value ${index + 1}`}
                    placeholder="Value"
                    value={value}
                    onChange={(event) =>
                      setEntries((current) =>
                        current.map((entry, i) =>
                          i === index ? [entry[0], event.target.value] : entry
                        )
                      )
                    }
                  />
                  <button
                    className="btn"
                    aria-label={`Remove metadata ${index + 1}`}
                    onClick={() => setEntries((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="btn"
                onClick={() => setEntries((current) => [...current, ['', '']])}
              >
                Add metadata
              </button>
            </fieldset>
            <p style={{ color: 'var(--text-muted)' }}>
              Saving updates this object's metadata using a server-side copy. Its key and file
              content stay the same.
            </p>
          </>
        )
      )}
      {(error || validationError) && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error ?? validationError}
        </p>
      )}
    </Modal>
  );
}
