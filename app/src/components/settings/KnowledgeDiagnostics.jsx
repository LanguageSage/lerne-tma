import { useEffect, useMemo, useState } from 'react';
import { tr } from '../../i18n/locale';
import { useInterfaceLocale } from '../../i18n/useInterfaceLocale';
import { getDiagnosticsItems, getDiagnosticsSummary } from '../../services/knowledgeDiagnosticsService';
import { mapPoint } from './knowledgeDiagnosticsMap';
import './KnowledgeDiagnostics.css';

const statuses = ['unobserved', 'insufficient', 'weak', 'developing', 'strong'];
const sorts = ['name', 'proficiency', 'confidence', 'evidence_mass', 'evidence_event_count', 'last_evidence_at'];
const initial = { search: '', language: '', category: '', cefr_level: '', diagnostic_status: '', confidence: '', has_objective_evidence: '' };
const fmt = value => value == null ? '—' : Number(value).toFixed(2);
const date = value => value ? new Date(value).toLocaleString() : '—';
const errorText = error => error?.response?.data?.detail || error?.message || tr('Не удалось загрузить данные');

function SectionState({ loading, error, retry, empty }) {
  if (loading) return <p role="status">{tr('Загрузка…')}</p>;
  if (error) return <p role="alert">{String(error)} <button type="button" onClick={retry}>{tr('Повторить')}</button></p>;
  if (empty) return <p>{empty}</p>;
  return null;
}

function Summary({ data, loading, error, retry }) {
  if (!data) return <SectionState loading={loading} error={error} retry={retry} />;
  const counts = [
    ['Observed', data.observed_knowledge_items], ['Unobserved', data.unobserved_knowledge_items],
    ['Strong', data.strong_count], ['Developing', data.developing_count],
    ['Weak', data.weak_count], ['Insufficient', data.insufficient_count],
    ['Raw attempts', data.raw_attempt_count], ['Scorable', data.scorable_attempt_count],
    ['Ignored', data.ignored_attempt_count], ['Objective', data.objective_event_count],
    ['Self rating', data.self_rating_event_count], ['State mismatches', data.state_mismatch_count],
  ];
  return <section className="kd-section" aria-label="Summary">
    <h3>Summary</h3>
    <div className="kd-summary">{counts.map(([label, value]) => <div key={label} className={(label === 'Ignored' || label === 'State mismatches') && value > 0 ? 'kd-warning' : ''}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <p className="kd-meta">Classification: <code>{data.classification_source}</code> · Calculation versions: <code>{data.calculation_versions?.join(', ') || '—'}</code></p>
    {error && <SectionState error={error} retry={retry} />}
  </section>;
}

function KnowledgeMap({ data, loading, error, retry }) {
  if (!data) return <section className="kd-section"><h3>Knowledge Map</h3><SectionState loading={loading} error={error} retry={retry} /></section>;
  const observed = data.items.filter(item => item.recomputed_state.diagnostic_status !== 'unobserved');
  const unobserved = data.items.length - observed.length;
  return <section className="kd-section" aria-label="Knowledge Map">
    <h3>Knowledge Map</h3>
    <p className="kd-meta">X: proficiency · Y: confidence · Unobserved excluded: {unobserved}{data.total > data.items.length ? ` · Map shows first ${data.items.length} of ${data.total} items` : ''}</p>
    {observed.length === 0 ? <p>{tr('Нет наблюдаемых KI в выборке')}</p> : <div className="kd-map-scroll"><svg viewBox="0 0 520 325" role="img" aria-label="Knowledge items by recomputed proficiency and confidence">
      <line className="kd-axis" x1="48" y1="48" x2="48" y2="278"/><line className="kd-axis" x1="48" y1="278" x2="468" y2="278"/>
      <line className="kd-guide" x1="48" y1="174.5" x2="468" y2="174.5"/><line className="kd-guide" x1="216" y1="48" x2="216" y2="278"/><line className="kd-guide" x1="342" y1="48" x2="342" y2="278"/>
      <text x="4" y="54">1.0</text><text x="4" y="179">.45</text><text x="4" y="281">0</text><text x="48" y="299">0</text><text x="205" y="299">.40</text><text x="331" y="299">.70</text><text x="458" y="299">1</text>
      <text x="5" y="22">confidence</text><text x="388" y="318">proficiency</text>
      <text className="kd-zone" x="65" y="69">weak</text><text className="kd-zone" x="230" y="69">developing</text><text className="kd-zone" x="382" y="69">strong</text><text className="kd-zone" x="65" y="263">insufficient</text>
      {observed.map(item => { const point = mapPoint(item); const state = item.recomputed_state; return <circle key={item.id} cx={point.x} cy={point.y} r="6" className={`kd-point kd-${state.diagnostic_status}${item.state_matches_rebuild ? '' : ' kd-mismatch'}`} tabIndex="0" aria-label={`${item.name}: ${state.diagnostic_status}, proficiency ${fmt(state.proficiency)}, confidence ${fmt(state.confidence)}, integrity ${item.state_matches_rebuild ? 'OK' : 'Mismatch'}`}><title>{`${item.name} · ${item.cefr_level || '—'} · ${item.category || '—'}\nStatus: ${state.diagnostic_status}\nProficiency: ${fmt(state.proficiency)} · Confidence: ${fmt(state.confidence)}\nEvidence mass: ${fmt(state.evidence_mass)} · Events: ${state.evidence_event_count} · Objective: ${state.objective_event_count}\nIntegrity: ${item.state_matches_rebuild ? 'OK' : 'Mismatch'}`}</title></circle>; })}
    </svg></div>}
    <p className="kd-meta">Outlined point: state mismatch. Zones are visual guides; status comes from the API.</p>
    {error && <SectionState error={error} retry={retry} />}
  </section>;
}

export function KnowledgeDiagnostics() {
  useInterfaceLocale();
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [map, setMap] = useState(null);
  const [mapError, setMapError] = useState(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [filters, setFilters] = useState(initial);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState(null);
  const [rowsError, setRowsError] = useState(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const query = useMemo(() => {
    const { confidence, ...rest } = filters;
    return { ...rest, ...(confidence === 'low' ? { confidence_max: 0.44999999999999996 } : confidence === 'established' ? { confidence_min: 0.45 } : {}), sort_by: sortBy, sort_dir: sortDir, limit, offset };
  }, [filters, sortBy, sortDir, limit, offset]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) setSummaryLoading(true); }); getDiagnosticsSummary().then(data => { if (active) { setSummary(data); setSummaryError(null); } }).catch(error => { if (active) setSummaryError(errorText(error)); }).finally(() => { if (active) setSummaryLoading(false); }); return () => { active = false; }; }, [revision]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) setMapLoading(true); }); getDiagnosticsItems({ limit: 100, offset: 0, sort_by: 'name', sort_dir: 'asc' }).then(data => { if (active) { setMap(data); setMapError(null); } }).catch(error => { if (active) setMapError(errorText(error)); }).finally(() => { if (active) setMapLoading(false); }); return () => { active = false; }; }, [revision]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) setRowsLoading(true); }); getDiagnosticsItems(query).then(data => { if (active) { setRows(data); setRowsError(null); } }).catch(error => { if (active) setRowsError(errorText(error)); }).finally(() => { if (active) setRowsLoading(false); }); return () => { active = false; }; }, [query, revision]);
  const setFilter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setOffset(0); };
  const retry = () => setRevision(value => value + 1);
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil((rows?.total || 0) / limit));
  return <div className="kd"><header><h2>Knowledge Diagnostics <small>Debug</small></h2><p>Read-only, recomputed from raw attempts.</p></header>
    <Summary data={summary} loading={summaryLoading} error={summaryError} retry={retry} />
    <KnowledgeMap data={map} loading={mapLoading} error={mapError} retry={retry} />
    <section className="kd-section" aria-label="Knowledge Items"><h3>Knowledge Items</h3>
      <form className="kd-filters" onSubmit={event => { event.preventDefault(); setFilter('search', search.trim()); }}>
        <label>Search<input value={search} onChange={event => setSearch(event.target.value)} maxLength="200" placeholder="KI name" /></label><button type="submit">Search</button>
        {['language', 'category', 'cefr_level'].map(key => <label key={key}>{key === 'cefr_level' ? 'CEFR' : key}<input value={filters[key]} onChange={event => setFilter(key, event.target.value)} /></label>)}
        <label>Status<select value={filters.diagnostic_status} onChange={event => setFilter('diagnostic_status', event.target.value)}><option value="">All</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
        <label>Confidence<select value={filters.confidence} onChange={event => setFilter('confidence', event.target.value)}><option value="">All</option><option value="low">Low &lt; .45</option><option value="established">Established ≥ .45</option></select></label>
        <label>Objective evidence<select value={filters.has_objective_evidence} onChange={event => setFilter('has_objective_evidence', event.target.value)}><option value="">All</option><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>Sort<select value={sortBy} onChange={event => { setSortBy(event.target.value); setOffset(0); }}>{sorts.map(sort => <option key={sort} value={sort}>{sort}</option>)}</select></label>
        <label>Direction<select value={sortDir} onChange={event => { setSortDir(event.target.value); setOffset(0); }}><option value="asc">ASC</option><option value="desc">DESC</option></select></label>
      </form>
      {rowsLoading && <SectionState loading />}{rowsError && <SectionState error={rowsError} retry={retry} />}
      {!rowsLoading && !rowsError && rows?.total === 0 && <p>{Object.values(filters).some(Boolean) ? 'No results for filters.' : 'No Knowledge Items.'}</p>}
      {!rowsLoading && !rowsError && rows?.items?.length > 0 && <div className="kd-table-scroll"><table><thead><tr>{['Knowledge Item', 'CEFR', 'Category', 'Status', 'Proficiency', 'Confidence', 'Evidence', 'Events', 'Objective', 'Raw', 'Ignored', 'Integrity', 'Last evidence'].map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{rows.items.map(item => { const state = item.recomputed_state; return <tr key={item.id} className={item.state_matches_rebuild ? '' : 'kd-row-mismatch'}><th scope="row">{item.name}</th><td>{item.cefr_level || '—'}</td><td>{item.category || '—'}</td><td><span className={`kd-status kd-${state.diagnostic_status}`}>{state.diagnostic_status}</span></td><td>{state.diagnostic_status === 'unobserved' ? '—' : fmt(state.proficiency)}</td><td>{fmt(state.confidence)}</td><td>{fmt(state.evidence_mass)}</td><td>{state.evidence_event_count}</td><td>{state.objective_event_count}</td><td>{item.raw_attempt_count}</td><td>{item.ignored_attempt_count}</td><td className={item.state_matches_rebuild ? '' : 'kd-warning'}>{item.state_matches_rebuild ? 'OK' : '⚠ Mismatch'}</td><td>{date(state.last_evidence_at)}</td></tr>; })}</tbody></table></div>}
      <div className="kd-pagination"><label>Rows <select value={limit} onChange={event => { setLimit(Number(event.target.value)); setOffset(0); }}><option>25</option><option>50</option><option>100</option></select></label><span>Page {page} / {pages} · {rows?.total ?? '—'} items</span><button type="button" disabled={offset === 0 || rowsLoading} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button><button type="button" disabled={!rows || offset + limit >= rows.total || rowsLoading} onClick={() => setOffset(offset + limit)}>Next</button></div>
    </section>
  </div>;
}
