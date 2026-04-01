import { useState, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Upload, FileText, Image, File, X, ShieldCheck, ShieldX,
  AlertTriangle, Clock, ChevronDown, ChevronRight, ScanLine,
} from 'lucide-react';
import clsx from 'clsx';
import { scanFiles, scanText } from '../lib/scanner-api';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';

type ScanStatus = 'clean' | 'flagged' | 'blocked' | 'error';
type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';
type Tab = 'file' | 'text';

const riskColor: Record<RiskLevel, string> = {
  none:     '',
  low:      'text-accent-400',
  medium:   'text-yellow-400',
  high:     'text-orange-400',
  critical: 'text-red-400',
};

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
];

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return FileText;
  return File;
}

export function ContentScannerPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);

  const statusConfig: Record<ScanStatus, { icon: typeof ShieldCheck; color: string; bg: string; label: string }> = {
    clean:   { icon: ShieldCheck,   color: 'text-accent-400',  bg: 'bg-accent-500/20',  label: 'Clean' },
    flagged: { icon: AlertTriangle, color: 'text-yellow-400',  bg: 'bg-yellow-500/20',  label: 'Flagged' },
    blocked: { icon: ShieldX,       color: 'text-red-400',     bg: 'bg-red-500/20',     label: 'Blocked' },
    error:   { icon: AlertTriangle, color: isDark ? 'text-slate-400' : 'text-gray-500', bg: isDark ? 'bg-slate-700' : 'bg-gray-200', label: 'Error' },
  };

  const [tab, setTab] = useState<Tab>('file');
  const [dragOver, setDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [textInput, setTextInput] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [expandedScan, setExpandedScan] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const fileMutation = useMutation({
    mutationFn: () => {
      setUploadProgress(0);
      return scanFiles(selectedFiles, (pct) => setUploadProgress(pct));
    },
    onSuccess: (data) => { setScanResult(data); setUploadProgress(null); },
    onError: () => setUploadProgress(null),
  });

  const textMutation = useMutation({
    mutationFn: () => scanText(textInput),
    onSuccess: (data) => setScanResult({ scanResults: [data], summary: { total: 1 } }),
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) => ACCEPTED_TYPES.includes(f.type));
    setSelectedFiles((prev) => [...prev, ...files]);
    setScanResult(null);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles((prev) => [...prev, ...files]);
    setScanResult(null);
  };

  const removeFile = (idx: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
    setScanResult(null);
  };

  const isScanning = fileMutation.isPending || textMutation.isPending;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Tab switcher */}
      <div className={clsx('flex gap-1 border rounded-xl p-1 w-fit', t.card)}>
        {(['file', 'text'] as Tab[]).map((tb) => (
          <button
            key={tb}
            onClick={() => { setTab(tb); setScanResult(null); }}
            className={clsx(
              'px-5 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
              tab === tb ? 'bg-brand-600 text-white' : clsx(t.sub, t.hoverText)
            )}
          >
            {tb === 'file' ? 'File / Image Upload' : 'Text Scan'}
          </button>
        ))}
      </div>

      {tab === 'file' ? (
        <div className="space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={clsx(
              'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all',
              dragOver
                ? 'border-brand-500 bg-brand-600/10'
                : clsx(isDark ? 'border-white/20 hover:border-white/40' : 'border-gray-300 hover:border-gray-400', t.hoverRow)
            )}
          >
            <Upload className={clsx('w-10 h-10 mx-auto mb-3', t.muted)} />
            <p className={clsx('font-medium mb-1', t.heading)}>Drop files here or click to browse</p>
            <p className={clsx('text-sm', t.muted)}>
              PDF, DOCX, XLSX, TXT, CSV, PNG, JPG, GIF, WEBP — up to 500MB each
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES.join(',')}
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              {selectedFiles.map((file, idx) => {
                const Icon = fileIcon(file.type);
                return (
                  <div key={idx} className={clsx('flex items-center gap-3 border rounded-xl px-4 py-3', t.card)}>
                    <Icon className={clsx('w-4 h-4 flex-shrink-0', t.sub)} />
                    <div className="flex-1 min-w-0">
                      <p className={clsx('text-sm truncate', t.heading)}>{file.name}</p>
                      <p className={clsx('text-xs', t.muted)}>{(file.size / 1024).toFixed(1)} KB · {file.type}</p>
                    </div>
                    <button onClick={() => removeFile(idx)} className={clsx('hover:text-red-400 transition-colors', t.faint)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <button
            onClick={() => fileMutation.mutate()}
            disabled={selectedFiles.length === 0 || isScanning}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            <ScanLine className={clsx('w-4 h-4', isScanning && 'animate-pulse')} />
            {uploadProgress !== null
              ? `Uploading... ${uploadProgress}%`
              : isScanning
                ? 'Scanning...'
                : `Scan ${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''}`}
          </button>
          {uploadProgress !== null && (
            <div className={clsx('h-1.5 rounded-full overflow-hidden', t.track)}>
              <div className="h-full bg-brand-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={clsx('block text-sm mb-2', t.sub)}>Paste text to scan for PII and sensitive data</label>
            <textarea
              rows={8}
              value={textInput}
              onChange={(e) => { setTextInput(e.target.value); setScanResult(null); }}
              placeholder="Paste any text here — emails, documents, prompts, logs..."
              className={clsx('w-full border rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-brand-500 resize-none', t.input)}
            />
          </div>
          <button
            onClick={() => textMutation.mutate()}
            disabled={!textInput.trim() || isScanning}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            <ScanLine className={clsx('w-4 h-4', isScanning && 'animate-pulse')} />
            {isScanning ? 'Scanning...' : 'Scan Text'}
          </button>
        </div>
      )}

      {/* Results */}
      {scanResult && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total', value: scanResult.summary?.total ?? 1, color: t.heading },
              { label: 'Clean', value: scanResult.summary?.clean ?? 0, color: 'text-accent-400' },
              { label: 'Flagged', value: scanResult.summary?.flagged ?? 0, color: 'text-yellow-400' },
              { label: 'Blocked', value: scanResult.summary?.blocked ?? 0, color: 'text-red-400' },
            ].map((s) => (
              <div key={s.label} className={clsx('border rounded-xl p-4 text-center', t.card)}>
                <p className={clsx('text-2xl font-bold', s.color)}>{s.value}</p>
                <p className={clsx('text-xs mt-0.5', t.muted)}>{s.label}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {(scanResult.scanResults || []).map((result: any) => {
              const cfg = statusConfig[result.status as ScanStatus] ?? statusConfig.error;
              const isExpanded = expandedScan === result.scanId;

              return (
                <div key={result.scanId} className={clsx('border rounded-xl overflow-hidden', t.card)}>
                  <div
                    className={clsx('flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors', t.hoverRow)}
                    onClick={() => setExpandedScan(isExpanded ? null : result.scanId)}
                  >
                    <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', cfg.bg)}>
                      <cfg.icon className={clsx('w-4 h-4', cfg.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className={clsx('font-medium text-sm truncate', t.heading)}>{result.fileName || 'Text scan'}</p>
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', cfg.bg, cfg.color)}>
                          {cfg.label}
                        </span>
                        <span className={clsx('text-xs font-medium', riskColor[result.riskLevel as RiskLevel] || t.muted)}>
                          {result.riskLevel} risk
                        </span>
                      </div>
                      <p className={clsx('text-xs', t.muted)}>
                        {result.piiDetected ? `PII detected: ${result.piiTypes.join(', ')}` : 'No PII detected'}
                        {result.scanDurationMs ? ` · ${result.scanDurationMs}ms` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className={clsx('text-xs', t.muted)}>Risk score</p>
                        <p className={clsx('text-sm font-bold', riskColor[result.riskLevel as RiskLevel] || t.muted)}>
                          {result.riskScore}/100
                        </p>
                      </div>
                      {isExpanded ? <ChevronDown className={clsx('w-4 h-4', t.muted)} /> : <ChevronRight className={clsx('w-4 h-4', t.muted)} />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className={clsx('border-t px-5 py-4 space-y-4', t.border)}>
                      {result.blockedReasons?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-red-400 uppercase tracking-wider mb-2">Blocked reasons</p>
                          <ul className="space-y-1">
                            {result.blockedReasons.map((r: string, i: number) => (
                              <li key={i} className={clsx('text-sm flex items-start gap-2', t.body)}>
                                <ShieldX className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                                {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {result.extractedText && (
                        <div>
                          <p className={clsx('text-xs font-medium uppercase tracking-wider mb-2', t.muted)}>
                            Extracted text (PII masked)
                          </p>
                          <pre className={clsx('border rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto', t.deep, t.border, t.body)}>
                            {result.extractedText}
                          </pre>
                        </div>
                      )}

                      {result.documentScan && (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          <div className={clsx('rounded-lg p-3', t.cardInner)}>
                            <p className={clsx('mb-1', t.muted)}>Pages</p>
                            <p className={clsx('font-medium', t.heading)}>{result.documentScan.pageCount}</p>
                          </div>
                          <div className={clsx('rounded-lg p-3', t.cardInner)}>
                            <p className={clsx('mb-1', t.muted)}>Sensitive data types</p>
                            <p className={clsx('font-medium', t.heading)}>
                              {result.documentScan.sensitiveDataTypes?.join(', ') || 'None'}
                            </p>
                          </div>
                        </div>
                      )}

                      {result.imageScan && (
                        <div>
                          {result.imageScan.moderationLabels?.length > 0 && (
                            <div>
                              <p className={clsx('text-xs font-medium uppercase tracking-wider mb-2', t.muted)}>
                                Moderation labels
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {result.imageScan.moderationLabels.map((l: any) => (
                                  <span key={l.name} className="text-xs bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">
                                    {l.name} ({l.confidence.toFixed(0)}%)
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {result.imageScan.detectedText && (
                            <div className="mt-3">
                              <p className={clsx('text-xs font-medium uppercase tracking-wider mb-2', t.muted)}>Text in image</p>
                              <p className={clsx('text-sm font-mono rounded-lg p-3', t.body, t.deep)}>
                                {result.imageScan.detectedText}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
