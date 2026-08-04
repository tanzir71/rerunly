import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_LM_STUDIO_URL,
  DEFAULT_OPENROUTER_URL
} from '../../src/shared/constants';
import type {
  ActiveRunView,
  AppState,
  AvailableModel,
  BackgroundCommand,
  BackgroundResponse,
  PanelEvent,
  ProviderKind,
  ProviderProfile,
  SavedTask,
  SecretBinding,
  SecretMetadata
} from '../../src/shared/types';
import { previewConfiguration } from './preview';

type Section = 'chat' | 'tasks' | 'vault' | 'history' | 'settings';

const EMPTY_STATE: AppState = {
  providers: [],
  tasks: [],
  runs: [],
  secrets: [],
  settings: { visualDisclosureAccepted: {} }
};

async function send<T>(command: BackgroundCommand): Promise<T> {
  const response = (await browser.runtime.sendMessage(command)) as BackgroundResponse<T>;
  if (!response?.ok) throw new Error(response?.error ?? 'Rerunly did not respond.');
  return response.data;
}

function Icon({ name }: { name: Section | 'play' | 'stop' | 'plus' | 'eye' | 'shield' }) {
  const paths: Record<string, ReactNode> = {
    chat: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.7a2.5 2.5 0 0 1-1-2V5.5Z" />,
    tasks: <><path d="M8 6h11M8 12h11M8 18h7"/><path d="m3.5 6 .9.9L6 5.2m-2.5 6.8.9.9L6 11.2m-2.5 6.8.9.9L6 17.2"/></>,
    vault: <><rect x="4" y="9" width="16" height="11" rx="2"/><path d="M8 9V7a4 4 0 0 1 8 0v2m-4 4v3"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5m4-1v5l3 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.37.36.7.6 1 .3.26.7.4 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7.6Z"/></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    plus: <path d="M12 5v14M5 12h14" />,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
    shield: <path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-4" />
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(timestamp);
}

function elapsed(startedAt: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function VisualBadge({ provider }: { provider?: ProviderProfile }) {
  return (
    <div className={`visual-badge ${provider?.kind === 'lmstudio' ? 'local' : 'remote'}`}>
      <span className="pulse" />
      <Icon name="eye" />
      <span>
        Visual access active
        <small>{provider?.kind === 'lmstudio' ? 'Local vision' : 'Remote vision'}</small>
      </span>
    </div>
  );
}

function ActiveRunCard({ run, onStop, onResolve }: {
  run: ActiveRunView;
  onStop: () => void;
  onResolve: (id: string, approved: boolean) => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section className="run-card">
      <div className="run-heading">
        <div>
          <span className="eyebrow">Live run</span>
          <h2>{run.taskName}</h2>
        </div>
        <button className="button danger compact" onClick={onStop}>
          <Icon name="stop" /> Stop
        </button>
      </div>
      <div className="run-meta">
        <span className={`status ${run.status}`}>{run.status.replaceAll('_', ' ')}</span>
        <span>{elapsed(run.startedAt)}</span>
        <span>{run.actionCount} actions</span>
      </div>
      <div className="run-now">
        <span>Now</span>
        <strong>{run.currentAction?.replace('browser_', '') ?? 'Preparing visual context'}</strong>
        <p>{run.expectedOutcome ?? run.objective}</p>
      </div>
      {run.approval && (
        <div className="approval">
          <Icon name="shield" />
          <div>
            <strong>{run.approval.title}</strong>
            <p>{run.approval.reason}</p>
            <code>{run.approval.origin}</code>
            <div className="button-row">
              <button className="button primary" onClick={() => onResolve(run.approval!.id, true)}>Allow once</button>
              <button className="button ghost" onClick={() => onResolve(run.approval!.id, false)}>Decline</button>
            </div>
          </div>
        </div>
      )}
      <div className="timeline">
        {run.timeline.slice(-7).reverse().map((item) => (
          <div className={`timeline-item ${item.tone}`} key={item.id}>
            <span className="timeline-dot" />
            <div><strong>{item.title}</strong><p>{item.detail}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ChatView({
  state,
  activeProvider,
  onError,
  onCreateTask,
  objective,
  successCriteria: criteria,
  onObjectiveChange,
  onSuccessCriteriaChange
}: {
  state: AppState;
  activeProvider?: ProviderProfile;
  onError: (message: string) => void;
  onCreateTask: (instruction: string, success: string) => void;
  objective: string;
  successCriteria: string;
  onObjectiveChange: (value: string) => void;
  onSuccessCriteriaChange: (value: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const canRun = Boolean(
    objective.trim() &&
    activeProvider &&
    state.settings.visualDisclosureAccepted[activeProvider.id] &&
    !state.activeRun
  );
  const start = async () => {
    setBusy(true);
    try {
      await send({ type: 'START_CHAT', objective, successCriteria: criteria });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  return (
    <div className="view-stack">
      <div className="hero-card">
        <span className="eyebrow">Visually verified browser work</span>
        <h1>What should Rerunly do?</h1>
        <p>It will inspect, act once, capture the result, and verify before continuing.</p>
        <label>
          Task instruction
          <textarea rows={5} value={objective} onChange={(event) => onObjectiveChange(event.target.value)} placeholder="Compare the prices in these tabs and put the lowest one into the open form…" />
        </label>
        <label>
          Visible success criteria <span className="optional">optional</span>
          <textarea rows={2} value={criteria} onChange={(event) => onSuccessCriteriaChange(event.target.value)} placeholder="The form shows a green confirmation with the selected price." />
        </label>
        {!activeProvider && <div className="inline-notice warning">Configure a vision + tool model in Settings first.</div>}
        {activeProvider && !state.settings.visualDisclosureAccepted[activeProvider.id] && (
          <div className="inline-notice warning">Accept the visual-data disclosure in Settings before running.</div>
        )}
        <div className="button-row">
          <button className="button primary large" disabled={!canRun || busy} onClick={start}>
            <Icon name="play" /> {busy ? 'Starting…' : 'Run visually'}
          </button>
          <button className="button ghost" disabled={!objective.trim()} onClick={() => onCreateTask(objective, criteria)}>
            Save as task
          </button>
        </div>
      </div>
      <div className="privacy-strip">
        <Icon name="shield" />
        <div><strong>Two-pass verification</strong><p>The action planner and visual verifier use separate model calls.</p></div>
      </div>
    </div>
  );
}

function parseLines(value: string): Record<string, string> {
  return Object.fromEntries(value.split('\n').map((line) => line.split('=')).filter((parts) => parts.length >= 2).map(([key, ...rest]) => [key!.trim(), rest.join('=').trim()]).filter(([key]) => key));
}

function TaskEditor({ task, providers, secrets, onSaved, onCancel, onError }: {
  task?: Partial<SavedTask>;
  providers: ProviderProfile[];
  secrets: SecretMetadata[];
  onSaved: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(task?.name ?? '');
  const [instruction, setInstruction] = useState(task?.instruction ?? '');
  const [criteria, setCriteria] = useState(task?.successCriteria ?? '');
  const [providerId, setProviderId] = useState(task?.providerProfileId ?? providers[0]?.id ?? '');
  const [startMode, setStartMode] = useState(task?.startMode ?? 'current_tab');
  const [startUrl, setStartUrl] = useState(task?.startUrl ?? '');
  const [origins, setOrigins] = useState((task?.allowedOrigins ?? []).join('\n'));
  const [variables, setVariables] = useState(Object.entries(task?.ordinaryVariables ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'));
  const [bindings, setBindings] = useState<SecretBinding[]>(task?.secretBindings ?? []);
  const [secretId, setSecretId] = useState('');
  const [alias, setAlias] = useState('');
  const [busy, setBusy] = useState(false);
  const addSecret = () => {
    const secret = secrets.find((item) => item.id === secretId && item.purpose === 'task_variable');
    if (!secret || !alias.trim()) return;
    setBindings((current) => [...current.filter((item) => item.alias !== alias.trim()), {
      alias: alias.trim(), secretId: secret.id, allowedOrigins: origins.split('\n').map((item) => item.trim()).filter(Boolean), fieldHints: secret.fieldHints
    }]);
    setAlias(''); setSecretId('');
  };
  const save = async () => {
    setBusy(true);
    try {
      await send({ type: 'SAVE_TASK', task: {
        ...(task?.id ? { id: task.id } : {}), name, instruction, successCriteria: criteria,
        providerProfileId: providerId, startMode, ...(startUrl ? { startUrl } : {}),
        allowedOrigins: origins.split('\n').map((item) => item.trim()).filter(Boolean),
        ordinaryVariables: parseLines(variables), secretBindings: bindings
      }});
      onSaved();
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return (
    <section className="editor-card">
      <div className="section-heading"><div><span className="eyebrow">Reusable workflow</span><h2>{task?.id ? 'Edit task' : 'New task'}</h2></div></div>
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Weekly stock check" /></label>
      <label>Instruction<textarea rows={5} value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
      <label>Visible success criteria<textarea rows={3} value={criteria} onChange={(event) => setCriteria(event.target.value)} /></label>
      <div className="two-col">
        <label>Provider<select value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label>Start mode<select value={startMode} onChange={(event) => setStartMode(event.target.value as SavedTask['startMode'])}><option value="current_tab">Current tab</option><option value="fixed_url">Fixed URL</option></select></label>
      </div>
      {startMode === 'fixed_url' && <label>Start URL<input type="url" value={startUrl} onChange={(event) => setStartUrl(event.target.value)} placeholder="https://example.com" /></label>}
      <label>Allowed origins <span className="optional">one per line</span><textarea rows={3} value={origins} onChange={(event) => setOrigins(event.target.value)} placeholder="https://example.com" /></label>
      <label>Ordinary variables <span className="optional">KEY=value, one per line</span><textarea rows={3} value={variables} onChange={(event) => setVariables(event.target.value)} placeholder="region=Dhaka" /></label>
      <div className="sub-card">
        <strong>Protected variables</strong>
        {bindings.map((binding) => <div className="binding" key={binding.alias}><code>{`{{secret:${binding.alias}}}`}</code><button onClick={() => setBindings((current) => current.filter((item) => item.alias !== binding.alias))}>Remove</button></div>)}
        <div className="binding-builder"><input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="alias"/><select value={secretId} onChange={(event) => setSecretId(event.target.value)}><option value="">Choose vault item</option>{secrets.filter((item) => item.purpose === 'task_variable').map((secret) => <option key={secret.id} value={secret.id}>{secret.label}</option>)}</select><button className="button ghost compact" onClick={addSecret}>Bind</button></div>
      </div>
      <div className="button-row"><button className="button primary" disabled={busy || !name || !instruction || !criteria || !providerId} onClick={save}>{busy ? 'Saving…' : 'Save task'}</button><button className="button ghost" onClick={onCancel}>Cancel</button></div>
    </section>
  );
}

function TasksView({ state, seed, clearSeed, onError }: { state: AppState; seed?: Partial<SavedTask>; clearSeed: () => void; onError: (message: string) => void }) {
  const [editing, setEditing] = useState<Partial<SavedTask> | null>(seed ?? null);
  useEffect(() => { if (seed) setEditing(seed); }, [seed]);
  const run = async (taskId: string) => { try { await send({ type: 'START_TASK', taskId }); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const remove = async (taskId: string) => { if (!confirm('Delete this saved task?')) return; try { await send({ type: 'DELETE_TASK', taskId }); } catch (error) { onError(String(error)); } };
  if (editing) return <TaskEditor task={editing} providers={state.providers} secrets={state.secrets} onSaved={() => { setEditing(null); clearSeed(); }} onCancel={() => { setEditing(null); clearSeed(); }} onError={onError}/>;
  return <div className="view-stack"><div className="section-heading"><div><span className="eyebrow">Reusable work</span><h1>Saved tasks</h1></div><button className="button primary compact" onClick={() => setEditing({})}><Icon name="plus"/> New</button></div>{state.tasks.length === 0 ? <Empty title="No saved tasks yet" detail="Save a good prompt once, then launch it with Play."/> : state.tasks.map((task) => <article className="item-card" key={task.id}><div className="item-top"><div><h3>{task.name}</h3><p>{task.instruction}</p></div><button className="play-button" disabled={Boolean(state.activeRun)} onClick={() => run(task.id)} aria-label={`Play ${task.name}`}><Icon name="play"/></button></div><div className="chips"><span>{task.allowedOrigins.length} origins</span><span>{task.secretBindings.length} protected</span><span>{task.maxActions} max actions</span></div><div className="text-actions"><button onClick={() => setEditing(task)}>Edit</button><button className="delete" onClick={() => remove(task.id)}>Delete</button></div></article>)}</div>;
}

function VaultView({ state, onError }: { state: AppState; onError: (message: string) => void }) {
  const [adding, setAdding] = useState(false); const [label, setLabel] = useState(''); const [value, setValue] = useState(''); const [origins, setOrigins] = useState(''); const [hints, setHints] = useState('');
  const save = async () => { try { await send({ type: 'SAVE_SECRET', secret: { label, value, purpose: 'task_variable', allowedOrigins: origins.split('\n').map((item) => item.trim()).filter(Boolean), fieldHints: hints.split(',').map((item) => item.trim()).filter(Boolean) }}); setAdding(false); setLabel(''); setValue(''); setOrigins(''); setHints(''); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } };
  const remove = async (secretId: string) => { if (!confirm('Delete this protected value? This cannot be undone.')) return; try { await send({ type: 'DELETE_SECRET', secretId }); } catch (error) { onError(String(error)); } };
  return <div className="view-stack"><div className="section-heading"><div><span className="eyebrow">Device vault</span><h1>Protected values</h1></div><button className="button primary compact" onClick={() => setAdding(!adding)}><Icon name="plus"/> Add</button></div><div className="inline-notice"><Icon name="shield"/><span>Values are AES-256-GCM encrypted locally. Passwords, OTPs, payment details, and identity documents are not supported.</span></div>{adding && <section className="editor-card"><label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Work email"/></label><label>Protected value<input type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off"/></label><label>Allowed origins <span className="optional">one per line</span><textarea rows={3} value={origins} onChange={(event) => setOrigins(event.target.value)} placeholder="https://example.com"/></label><label>Field hints <span className="optional">comma separated</span><input value={hints} onChange={(event) => setHints(event.target.value)} placeholder="email, contact field"/></label><div className="button-row"><button className="button primary" disabled={!label || !value} onClick={save}>Encrypt and save</button><button className="button ghost" onClick={() => setAdding(false)}>Cancel</button></div></section>}{state.secrets.filter((item) => item.purpose === 'task_variable').map((secret) => <article className="item-card vault-item" key={secret.id}><div className="vault-icon"><Icon name="vault"/></div><div><h3>{secret.label}</h3><p>{secret.allowedOrigins.length ? secret.allowedOrigins.join(', ') : 'No origins granted yet'}</p><small>Updated {formatDate(secret.updatedAt)}</small></div><button className="icon-delete" onClick={() => remove(secret.id)}>×</button></article>)}</div>;
}

function HistoryView({ state }: { state: AppState }) {
  return <div className="view-stack"><div className="section-heading"><div><span className="eyebrow">Sanitized summaries only</span><h1>Run history</h1></div></div>{state.runs.length === 0 ? <Empty title="No runs yet" detail="Your latest 20 textual run summaries will appear here."/> : state.runs.map((run) => <article className="history-card" key={run.id}><div className="history-top"><strong>{run.taskName}</strong><span className={`status ${run.status}`}>{run.status}</span></div><p>{run.sanitizedOutcome || run.objective}</p><div className="chips"><span>{formatDate(run.startedAt)}</span><span>{run.actionCount} actions</span><span>{run.recoveryCount} recoveries</span></div></article>)}</div>;
}

function SettingsView({ state, onError }: { state: AppState; onError: (message: string) => void }) {
  const active = state.providers.find((item) => item.id === state.settings.activeProviderId);
  const [editingId, setEditingId] = useState<string | undefined>(active?.id);
  const editing = state.providers.find((item) => item.id === editingId);
  const [kind, setKind] = useState<ProviderKind>(editing?.kind ?? 'openrouter');
  const [name, setName] = useState(editing?.name ?? 'OpenRouter');
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? DEFAULT_OPENROUTER_URL);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [modelId, setModelId] = useState(editing?.modelId ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) return; setKind(editing.kind); setName(editing.name); setBaseUrl(editing.baseUrl); setModelId(editing.modelId); setModels([{ id: editing.modelId, name: editing.modelId, capabilities: editing.capabilities }]); setApiKey(''); }, [editingId]);
  const changeKind = (next: ProviderKind) => { setKind(next); setName(next === 'openrouter' ? 'OpenRouter' : 'LM Studio'); setBaseUrl(next === 'openrouter' ? DEFAULT_OPENROUTER_URL : DEFAULT_LM_STUDIO_URL); setModels([]); setModelId(''); setEditingId(undefined); };
  const load = async () => { setBusy(true); try { const result = await send<AvailableModel[]>({ type: 'GET_MODELS', kind, baseUrl, ...(apiKey ? { apiKey } : {}), ...(editingId ? { providerId: editingId } : {}) }); setModels(result); if (!result.length) onError('No loaded model advertises both vision and native tool calling.'); else if (!result.some((item) => item.id === modelId)) setModelId(result[0]!.id); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const save = async () => { const model = models.find((item) => item.id === modelId); if (!model) return; setBusy(true); try { const profile = await send<ProviderProfile>({ type: 'SAVE_PROVIDER', provider: { ...(editingId ? { id: editingId } : {}), name, kind, baseUrl, modelId, capabilities: model.capabilities, ...(apiKey ? { apiKey } : {}) }}); setEditingId(profile.id); setApiKey(''); } catch (error) { onError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const accept = async (providerId: string) => { try { await send({ type: 'ACCEPT_VISUAL_DISCLOSURE', providerId }); } catch (error) { onError(String(error)); } };
  const select = async (providerId: string) => { try { await send({ type: 'SET_ACTIVE_PROVIDER', providerId }); setEditingId(providerId); } catch (error) { onError(String(error)); } };
  const removeProvider = async () => {
    if (!editingId || !confirm('Delete this provider profile and its encrypted API key?')) return;
    try { await send({ type: 'DELETE_PROVIDER', providerId: editingId }); setEditingId(undefined); changeKind('openrouter'); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  };
  return <div className="view-stack"><div className="section-heading"><div><span className="eyebrow">Vision model</span><h1>Provider settings</h1></div></div>{state.providers.length > 0 && <div className="provider-pills">{state.providers.map((provider) => <button className={provider.id === state.settings.activeProviderId ? 'active' : ''} onClick={() => select(provider.id)} key={provider.id}>{provider.name}<small>{provider.kind}</small></button>)}<button onClick={() => { setEditingId(undefined); changeKind('openrouter'); }}>+ New</button></div>}<section className="editor-card"><div className="segmented"><button className={kind === 'openrouter' ? 'active' : ''} onClick={() => changeKind('openrouter')}>OpenRouter</button><button className={kind === 'lmstudio' ? 'active' : ''} onClick={() => changeKind('lmstudio')}>LM Studio</button></div><label>Profile name<input value={name} onChange={(event) => setName(event.target.value)}/></label><label>Base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)}/></label>{kind === 'openrouter' && <label>API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={editing?.apiKeySecretId ? 'Stored securely — enter only to replace' : 'sk-or-v1-…'} autoComplete="off"/></label>}<div className="model-picker"><button className="button ghost" disabled={busy || (kind === 'openrouter' && !apiKey && !editing?.apiKeySecretId)} onClick={load}>{busy ? 'Checking…' : 'Find compatible models'}</button><select value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">Vision + tool model</option>{models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select></div><div className="button-row"><button className="button primary" disabled={busy || !modelId || !name} onClick={save}>Save provider</button>{editingId && <button className="button danger" onClick={removeProvider}>Delete provider</button>}</div></section>{active && <section className={`disclosure ${state.settings.visualDisclosureAccepted[active.id] ? 'accepted' : ''}`}><Icon name="eye"/><div><strong>{active.kind === 'lmstudio' ? 'Local visual processing' : 'Remote visual processing'}</strong><p>{active.kind === 'lmstudio' ? 'Redacted screenshots are sent only to your local LM Studio endpoint.' : 'Redacted screenshots are sent to OpenRouter and the selected upstream model provider. Other sensitive information visible on a page may still be captured.'}</p>{state.settings.visualDisclosureAccepted[active.id] ? <span className="accepted-label">Disclosure accepted</span> : <button className="button primary compact" onClick={() => accept(active.id)}>I understand and accept</button>}</div></section>}<div className="inline-notice"><Icon name="shield"/><span>Rerunly accepts local LM Studio endpoints only in V1. Provider keys are encrypted in IndexedDB and never stored in Chrome storage.</span></div></div>;
}

function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><div className="empty-mark">R</div><h3>{title}</h3><p>{detail}</p></div>; }

export default function App() {
  const preview = useMemo(() => previewConfiguration(), []);
  const [state, setState] = useState<AppState>(preview?.state ?? EMPTY_STATE);
  const [section, setSection] = useState<Section>(preview?.section ?? 'chat');
  const [error, setError] = useState('');
  const [taskSeed, setTaskSeed] = useState<Partial<SavedTask> | undefined>();
  const [chatObjective, setChatObjective] = useState(preview?.objective ?? '');
  const [chatCriteria, setChatCriteria] = useState(preview?.criteria ?? '');
  useEffect(() => {
    if (preview) return;
    let alive = true;
    void send<AppState>({ type: 'GET_STATE' }).then((next) => alive && setState(next)).catch((reason) => setError(String(reason)));
    const port = browser.runtime.connect({ name: 'rerunly-panel' });
    port.onMessage.addListener((event: PanelEvent) => { if (alive && event?.state) setState(event.state); });
    return () => { alive = false; port.disconnect(); };
  }, [preview]);
  useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(''), 6000); return () => window.clearTimeout(timer); }, [error]);
  useEffect(() => {
    if (!state.activeRun) return;
    const timer = window.setInterval(() => { void send({ type: 'KEEP_ALIVE' }).catch(() => undefined); }, 20_000);
    return () => window.clearInterval(timer);
  }, [state.activeRun?.id]);
  const activeProvider = useMemo(() => state.providers.find((item) => item.id === state.settings.activeProviderId), [state.providers, state.settings.activeProviderId]);
  const resolve = async (approvalId: string, approved: boolean) => { try { await send({ type: 'RESOLVE_APPROVAL', approvalId, approved }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  const stop = async () => { try { await send({ type: 'STOP_RUN' }); } catch (reason) { setError(String(reason)); } };
  const createTask = (instruction: string, success: string) => {
    void browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      let origin = '';
      try { origin = new URL(tabs[0]?.url ?? '').origin; } catch { /* Task editor can collect it. */ }
      setTaskSeed({
        instruction,
        successCriteria: success || 'The requested browser outcome is visibly complete.',
        name: '',
        ...(activeProvider ? {
          providerProfileId: activeProvider.id,
          modelId: activeProvider.modelId
        } : {}),
        ...(origin && origin !== 'null' ? { allowedOrigins: [origin] } : {})
      });
      setSection('tasks');
    });
  };
  const labels: Array<[Section, string]> = [['chat', 'Chat'], ['tasks', 'Tasks'], ['vault', 'Vault'], ['history', 'History'], ['settings', 'Settings']];
  return <div className="app-shell"><header><div className="brand"><div className="brand-mark"><span>R</span><i/></div><div><strong>Rerunly</strong><small>Save it. Play it. Rerun it.</small></div></div>{state.activeRun && <VisualBadge provider={activeProvider}/>}</header>{error && <div className="toast" role="alert"><strong>Rerunly needs attention</strong><span>{error}</span><button onClick={() => setError('')}>×</button></div>}<main>{state.activeRun && <ActiveRunCard run={state.activeRun} onStop={stop} onResolve={resolve}/>} {!state.activeRun && section === 'chat' && <ChatView state={state} activeProvider={activeProvider} onError={setError} onCreateTask={createTask} objective={chatObjective} successCriteria={chatCriteria} onObjectiveChange={setChatObjective} onSuccessCriteriaChange={setChatCriteria}/>} {!state.activeRun && section === 'tasks' && <TasksView state={state} seed={taskSeed} clearSeed={() => setTaskSeed(undefined)} onError={setError}/>} {!state.activeRun && section === 'vault' && <VaultView state={state} onError={setError}/>} {!state.activeRun && section === 'history' && <HistoryView state={state}/>} {!state.activeRun && section === 'settings' && <SettingsView state={state} onError={setError}/>}</main><nav>{labels.map(([id, label]) => <button className={section === id ? 'active' : ''} onClick={() => setSection(id)} key={id}><Icon name={id}/><span>{label}</span></button>)}</nav></div>;
}
