import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Bot, AlertTriangle, Shield, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { themeClasses } from '../lib/theme-classes';
import { useAuth } from '../lib/auth';
import { fetchModelConfigs, getGatewayUrl } from '../lib/api';
import { mockModelConfigs } from '../lib/mock-data';
import axios from 'axios';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: string;
  tokens?: number;
  latencyMs?: number;
  policyWarning?: string;
}

export function ChatPage() {
  const { isDark } = useTheme();
  const t = themeClasses(isDark);
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: modelsData } = useQuery({
    queryKey: ['model-configs'],
    queryFn: fetchModelConfigs,
    placeholderData: mockModelConfigs,
  });
  const models = (Array.isArray(modelsData) && modelsData.length ? modelsData : mockModelConfigs)
    .filter((m: any) => m.status === 'active');

  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      const def = models.find((m: any) => m.isDefault) || models[0];
      setSelectedModel((def as any).modelId);
    }
  }, [models, selectedModel]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || sending || !selectedModel) return;
    setError(null);
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const resp = await axios.post(
        `${getGatewayUrl()}/v1/chat/completions`,
        {
          model: selectedModel,
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          max_tokens: 2048,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-id': user?.tenantId || 'tenant_demo',
            'x-user-id': user?.userId || 'anonymous',
            authorization: 'Bearer test-key',
          },
          timeout: 60000,
        }
      );

      const data = resp.data;
      const assistantMsg: Message = {
        id: `msg_${Date.now()}_resp`,
        role: 'assistant',
        content: data.content || data.choices?.[0]?.message?.content || 'No response',
        timestamp: new Date().toISOString(),
        model: selectedModel,
        tokens: (data.inputTokens || 0) + (data.outputTokens || 0),
        latencyMs: data.latencyMs,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message || 'Request failed';
      const code = err?.response?.data?.code;
      if (code === 'POLICY_VIOLATION') {
        setMessages((prev) => [...prev, {
          id: `msg_${Date.now()}_blocked`,
          role: 'system',
          content: msg,
          timestamp: new Date().toISOString(),
          policyWarning: msg,
        }]);
      } else {
        setError(msg);
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const modelName = models.find((m: any) => m.modelId === selectedModel)?.name || selectedModel;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Model selector */}
      <div className={clsx('flex items-center gap-3 px-4 py-3 border-b', t.border)}>
        <Bot className="w-4 h-4 text-brand-400" />
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className={clsx('border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-brand-500', t.input)}
        >
          {models.map((m: any) => (
            <option key={m.modelId || m.modelConfigId} value={m.modelId}>{m.name}</option>
          ))}
        </select>
        <span className={clsx('text-xs', t.muted)}>{messages.length} messages</span>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} className={clsx('ml-auto text-xs transition-colors', t.muted, t.hoverText)}>
            Clear chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-2xl bg-brand-600/20 flex items-center justify-center mb-4">
              <Shield className="w-6 h-6 text-brand-400" />
            </div>
            <p className={clsx('font-semibold mb-1', t.heading)}>Governed AI Chat</p>
            <p className={clsx('text-sm max-w-md', t.muted)}>
              Your messages are routed through the AI governance gateway. Policies are enforced, PII is masked, and all interactions are logged.
            </p>
            <p className={clsx('text-xs mt-3', t.faint)}>Using {modelName}</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={clsx('flex gap-3', msg.role === 'user' ? 'justify-end' : '')}>
            {msg.role !== 'user' && (
              <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                msg.policyWarning ? 'bg-red-500/20' : 'bg-brand-600/20'
              )}>
                {msg.policyWarning ? <AlertTriangle className="w-4 h-4 text-red-400" /> : <Bot className="w-4 h-4 text-brand-400" />}
              </div>
            )}
            <div className={clsx('max-w-[75%] rounded-2xl px-4 py-3',
              msg.role === 'user'
                ? 'bg-brand-600 text-white'
                : msg.policyWarning
                  ? (isDark ? 'bg-red-500/10 border border-red-500/20' : 'bg-red-50 border border-red-200')
                  : t.cardInner
            )}>
              <p className={clsx('text-sm whitespace-pre-wrap', msg.role === 'user' ? '' : msg.policyWarning ? 'text-red-400' : t.body)}>
                {msg.content}
              </p>
              {msg.policyWarning && (
                <p className={clsx('text-xs mt-2 flex items-center gap-1', 'text-red-400')}>
                  <Shield className="w-3 h-3" /> Blocked by policy
                </p>
              )}
              {msg.role === 'assistant' && msg.tokens && (
                <p className={clsx('text-xs mt-2', t.faint)}>
                  {msg.tokens} tokens · {msg.latencyMs}ms · {msg.model?.split('.').pop()?.split('-')[0]}
                </p>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-lg bg-brand-600/30 flex items-center justify-center flex-shrink-0 text-brand-400 text-xs font-bold">
                {user?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'U'}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center flex-shrink-0">
              <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
            </div>
            <div className={clsx('rounded-2xl px-4 py-3', t.cardInner)}>
              <p className={clsx('text-sm', t.muted)}>Thinking...</p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className={clsx('mx-4 mb-2 flex items-center gap-2 text-sm rounded-lg px-4 py-2', isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600')}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Input */}
      <div className={clsx('px-4 py-3 border-t', t.border)}>
        <div className={clsx('flex items-end gap-3 border rounded-xl px-4 py-3', t.card)}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            rows={1}
            className={clsx('flex-1 resize-none bg-transparent text-sm focus:outline-none', t.heading, isDark ? 'placeholder-slate-600' : 'placeholder-gray-400')}
            style={{ maxHeight: 120 }}
            onInput={(e) => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending || !selectedModel}
            className="p-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white transition-colors flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className={clsx('text-xs mt-2 text-center', t.faint)}>
          All messages are governed by your organization's AI policies
        </p>
      </div>
    </div>
  );
}
