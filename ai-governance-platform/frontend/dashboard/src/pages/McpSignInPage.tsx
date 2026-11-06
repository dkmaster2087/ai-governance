import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { checkSignIn, getSignIn, removeSignIn, saveSignIn, SignIn, splitList } from '../lib/mcp-api';
import { errorMessage } from '../lib/rules-api';
import { Button, Note, Panel, SectionLabel } from '../components/kit/primitives';
import { McpTabs } from './McpServersPage';

const input = 'min-h-[42px] px-3 border border-line-strong rounded-lg bg-white';

function Form({ current }: { current: SignIn }) {
  const qc = useQueryClient();
  const [issuer, setIssuer] = useState(current.issuer ?? '');
  const [clientId, setClientId] = useState(current.clientId ?? '');
  const [secret, setSecret] = useState('');
  const [groupsClaim, setGroupsClaim] = useState(current.groupsClaim ?? 'groups');
  const [scopes, setScopes] = useState((current.extraScopes ?? []).join(' '));
  const [hours, setHours] = useState(String(current.sessionHours ?? 8));
  const save = useMutation({
    mutationFn: () => saveSignIn({ issuer: issuer.trim(), clientId: clientId.trim(), ...(secret ? { clientSecret: secret } : {}), groupsClaim: groupsClaim.trim() || 'groups', extraScopes: splitList(scopes.replace(/\s+/g, ',')), sessionHours: Number(hours) || 8 }),
    onSuccess: () => { setSecret(''); qc.invalidateQueries({ queryKey: ['mcp-sign-in'] }); },
  });
  const check = useMutation({ mutationFn: checkSignIn });
  const remove = useMutation({ mutationFn: removeSignIn, onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-sign-in'] }) });
  const ready = issuer.trim() && clientId.trim() && (secret || current.configured) && !save.isPending;

  return (
    <Panel aria-label="Identity provider" className="px-6 py-5 flex flex-col gap-4">
      <SectionLabel>Your identity provider</SectionLabel>
      <ol className="m-0 pl-5 text-sm text-ink-muted flex flex-col gap-1">
        <li>In Entra ID, Okta, Google or any OpenID Connect provider, register a web application for Probaline.</li>
        <li>Give it this redirect address: <code className="font-mono text-[12px] text-ink [overflow-wrap:anywhere]">{current.callbackUrl}</code></li>
        <li>Copy its issuer, client ID and a client secret here. To use groups, have the provider put them in the ID token.</li>
      </ol>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Issuer</span>
            <input className={input} value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://login.microsoftonline.com/<tenant>/v2.0" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Client ID</span>
            <input className={input} value={clientId} onChange={(e) => setClientId(e.target.value)} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Client secret {current.secretHint && <span className="font-normal text-ink-muted">(saved: {current.secretHint}; leave empty to keep)</span>}</span>
            <input className={input} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Groups claim</span>
            <input className={input} value={groupsClaim} onChange={(e) => setGroupsClaim(e.target.value)} placeholder="groups" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Extra scopes <span className="font-normal text-ink-muted">(e.g. offline_access groups)</span></span>
            <input className={input} value={scopes} onChange={(e) => setScopes(e.target.value)} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-sm font-semibold">Sign people in again after (hours)</span>
            <input className={input} type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        </div>
        <p className="m-0 text-sm text-ink-muted">With <code>offline_access</code>, Probaline asks your provider again every 15 minutes, so someone disabled there loses access at once; otherwise at the end of the period above.</p>
        {save.isError && <p role="alert" className="m-0 text-stop-text font-semibold">{errorMessage(save.error)}</p>}
        {check.data && <p role="status" className={check.data.ok ? 'm-0 font-semibold' : 'm-0 text-stop-text font-semibold'}>{check.data.message}</p>}
        <div className="flex gap-2 flex-wrap">
          <Button type="submit" disabled={!ready}>{save.isPending ? 'Saving…' : save.isSuccess ? 'Saved' : 'Save'}</Button>
          {current.configured && <Button type="button" variant="secondary" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? 'Checking…' : 'Check connection'}</Button>}
          {current.configured && <Button type="button" variant="ghost" disabled={remove.isPending} onClick={() => { if (window.confirm('Turn off sign-in for people? Signed-in agents stop working within 15 minutes.')) remove.mutate(); }}>Turn off</Button>}
        </div>
      </form>
    </Panel>
  );
}

export function McpSignInPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['mcp-sign-in'], queryFn: getSignIn });
  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <div>
        <h1 className="m-0 text-[34px] leading-[1.1] font-bold tracking-[-0.02em]">Sign-in for people</h1>
        <p className="m-0 mt-1.5 text-ink-muted text-[15px] max-w-[680px]">
          Let people connect Claude, ChatGPT, Cursor or VS Code to your MCP servers as themselves, with your company sign-in. Probaline keeps no passwords; each server decides which groups may connect.
        </p>
      </div>
      <McpTabs />
      {isError && <Panel className="px-6"><Note title="Couldn’t load sign-in settings."><button type="button" className="underline font-semibold" onClick={() => refetch()}>Try again</button></Note></Panel>}
      {isLoading && <Panel className="px-6 py-5"><p className="m-0 text-ink-muted">Loading…</p></Panel>}
      {data && <Form key={data.updatedAt ?? 'new'} current={data} />}
    </div>
  );
}
