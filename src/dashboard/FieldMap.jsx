import React, { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiService } from '../services/api';

const REFRESH_MS = 30000;
const SRI_LANKA = [7.8731, 80.7718];
const STALE_SECONDS = 5 * 60;

const th = { padding: '10px 16px' };
const headRow = { borderBottom: '1px solid var(--rule)', color: 'var(--muted)', fontSize: '11px', textTransform: 'none' };

const ageLabel = (seconds) => {
  if (seconds < 60) return 'just now';
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};

const colourFor = (officer) => {
  if (officer.ageSeconds > STALE_SECONDS) return '#64748b'; // last fix is old: grey
  return officer.role === 'NVO' ? '#a855f7' : '#10b981';
};

const todayInColombo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());

// Names come from the database; keep them out of the popup HTML as markup.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Live officer map (SRS FR-8) and the day's site visits (FR-14). The server decides what each
 * role may see: NVO positions are returned to MD and GM only, so this component simply draws
 * whatever it is given. Refreshes every 30 seconds.
 */
export const FieldMap = () => {
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const containerRef = useRef(null);
  const [live, setLive] = useState(null);
  const [visits, setVisits] = useState([]);
  const [date, setDate] = useState(todayInColombo());
  const [error, setError] = useState(null);
  const fitted = useRef(false);

  const load = useCallback(async () => {
    try {
      const [liveRes, visitRes] = await Promise.all([apiService.getLiveMap(), apiService.getVisits(date)]);
      setLive(liveRes);
      setVisits(visitRes.visits || []);
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not load field data');
    }
  }, [date]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current).setView(SRI_LANKA, 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw markers whenever the data changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !live) return;
    layer.clearLayers();
    const points = [];

    for (const site of live.sites) {
      points.push([site.lat, site.lng]);
      L.circle([site.lat, site.lng], { radius: live.geofenceMeters, color: '#3b82f6', weight: 1, fillOpacity: 0.08 })
        .bindPopup(`<strong>${escapeHtml(site.name)}</strong><br/>Site (${live.geofenceMeters} m arrival zone)`)
        .addTo(layer);
      L.circleMarker([site.lat, site.lng], { radius: 5, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 1 }).addTo(layer);
    }
    for (const o of live.officers) {
      points.push([o.lat, o.lng]);
      const where = o.siteName ? `At ${escapeHtml(o.siteName)}` : 'Travelling between sites';
      L.circleMarker([o.lat, o.lng], { radius: 9, color: '#0f172a', weight: 2, fillColor: colourFor(o), fillOpacity: 1 })
        .bindPopup(`<strong>${escapeHtml(o.name)}</strong> (${escapeHtml(o.role)})<br/>${where}<br/>Updated ${ageLabel(o.ageSeconds)}`)
        .addTo(layer);
    }
    if (points.length > 0 && !fitted.current) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
      fitted.current = true;
    }
  }, [live]);

  const officers = live?.officers ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px' }}>
      {error && <div role="alert" style={{ fontSize: '12px', color: 'var(--alarm)' }}>Field data unavailable: {error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', fontSize: '12px', color: 'var(--muted)' }}>
        <span><span style={{ color: '#10b981' }}>●</span> Visiting Officer</span>
        <span><span style={{ color: '#a855f7' }}>●</span> Night Visiting Officer (MD and GM only)</span>
        <span><span style={{ color: '#64748b' }}>●</span> Last fix over 5 minutes old</span>
        <span><span style={{ color: '#3b82f6' }}>●</span> Site and arrival zone</span>
        {live && <span style={{ marginLeft: 'auto' }}>{officers.length} officer{officers.length === 1 ? '' : 's'} reporting in the last {live.windowMinutes} min · refreshes every 30 s</span>}
      </div>

      <div ref={containerRef} role="application" aria-label="Live map of officers and sites" style={{ height: '420px', borderRadius: '12px', border: '1px solid var(--rule)', zIndex: 0 }} />

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', fontSize: '13px', fontWeight: '700', color: 'var(--ink)' }}>Officers on the map</div>
        {officers.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>No officer has shared a location recently.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead><tr style={headRow}><th style={th}>OFFICER</th><th style={th}>ROLE</th><th style={th}>LOCATION</th><th style={th}>LAST FIX</th></tr></thead>
              <tbody>
                {officers.map((o) => (
                  <tr key={o.epf} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...th, color: 'var(--ink-2)' }}>{o.name}</td>
                    <td style={{ ...th, color: 'var(--muted)' }}>{o.role}</td>
                    <td style={{ ...th, color: 'var(--muted)' }}>{o.siteName ? `At ${o.siteName}` : 'Travelling'}</td>
                    <td style={{ ...th, color: o.ageSeconds > STALE_SECONDS ? 'var(--brass-ink)' : 'var(--cleared)' }}>{ageLabel(o.ageSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--ink)' }}>Site visits</span>
          <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            DATE
            <input type="date" value={date} max={todayInColombo()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Visit date" />
          </label>
        </div>
        {visits.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>No site visits recorded for {date}.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="register" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={headRow}>
                  <th style={th}>OFFICER</th><th style={th}>SITE</th><th style={th}>ARRIVED</th><th style={th}>DEPARTED</th>
                  <th style={th}>MINUTES</th><th style={th}>TRAVEL (KM)</th><th style={th}>ON SITE</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.visitId} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...th, color: 'var(--ink-2)' }}>{v.officerName}<div style={{ fontSize: '11px', color: 'var(--dim)' }}>{v.officerRole}</div></td>
                    <td style={{ ...th, color: 'var(--muted)' }}>{v.siteName}</td>
                    <td style={{ ...th, color: 'var(--muted)' }}>{new Date(v.arrivedAt).toLocaleTimeString()}</td>
                    <td style={{ ...th, color: 'var(--muted)' }}>{v.departedAt ? new Date(v.departedAt).toLocaleTimeString() : 'In progress'}</td>
                    <td style={{ ...th, color: 'var(--ink)' }}>{v.durationMinutes ?? '—'}</td>
                    <td style={{ ...th, color: 'var(--ink)' }}>{v.travelKm}</td>
                    <td style={th}>
                      <span className={`badge ${v.onSite === false ? 'badge-danger' : v.onSite === true ? 'badge-success' : 'badge-warning'}`}>
                        {v.onSite === true ? 'Yes' : v.onSite === false ? `No (${v.distanceFromSiteM} m away)` : 'Unknown'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
