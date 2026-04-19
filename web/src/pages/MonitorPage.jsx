import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'

// ── Colors ────────────────────────────────────────────────────
const COLORS = {
  co2:        '#f59e0b',
  air_temp:   '#ef4444',
  probe1:     '#f97316',
  probe2:     '#fb923c',
  probe3:     '#fbbf24',
  probe4:     '#a3e635',
  hanna_temp: '#a78bfa',
  humidity:   '#38bdf8',
  ph:         '#34d399',
  tof:        '#818cf8',
  kbd_event:  '#fde68a',
  rfid_known: '#6ee7b7',
  rfid_unk:   '#94a3b8',
}

// ── Helpers ───────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
function fmtVal(v, dec=1) {
  if (v===null||v===undefined||isNaN(v)) return '—'
  return Number(v).toFixed(dec)
}
function viridisColor(t) {
  t = Math.max(0,Math.min(1,t))
  const r = Math.round(t<0.5 ? 68+t*2*(43-68)   : 43 +(t-0.5)*2*(253-43))
  const g = Math.round(t<0.5 ? 1 +t*2*(131-1)   : 131+(t-0.5)*2*(231-131))
  const b = Math.round(t<0.5 ? 84+t*2*(120-84)  : 120+(t-0.5)*2*(37-120))
  return `rgb(${r},${g},${b})`
}

// ── Spike filter ──────────────────────────────────────────────
function filterSpikes(vals, threshold) {
  if (threshold<=0) return vals
  const out = [...vals]
  for (let r=0; r<8; r++) {
    for (let c=0; c<8; c++) {
      const v = vals[r*8+c]
      if (v===null) continue
      const nb = []
      for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
        if (dr===0&&dc===0) continue
        const nr=r+dr, nc=c+dc
        if (nr>=0&&nr<8&&nc>=0&&nc<8&&vals[nr*8+nc]!==null) nb.push(vals[nr*8+nc])
      }
      if (!nb.length) continue
      nb.sort((a,b)=>a-b)
      const med = nb[Math.floor(nb.length/2)]
      if (Math.abs(v-med)>threshold) out[r*8+c]=null
    }
  }
  return out
}

// ── Tooltip ───────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active||!payload?.length) return null
  return (
    <div style={{ background:'#1a1a16', border:'1px solid #303028', padding:'8px 12px', borderRadius:4, fontSize:12, fontFamily:'JetBrains Mono,monospace' }}>
      <div style={{ color:'#888', marginBottom:4 }}>{fmtTime(label)}</div>
      {payload.map(p => <div key={p.dataKey} style={{ color:p.color }}>{p.name}: {fmtVal(p.value,2)}</div>)}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────
function Stat({ label, value, unit, color }) {
  return (
    <div style={{ background:'#111110', border:'1px solid #252520', borderRadius:6, padding:'10px 16px', minWidth:110 }}>
      <div style={{ fontSize:10, color:'#666', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:22, fontFamily:'JetBrains Mono,monospace', color:color||'#d4cfc8', lineHeight:1 }}>
        {value}<span style={{ fontSize:11, color:'#555', marginLeft:4 }}>{unit}</span>
      </div>
    </div>
  )
}

// ── Chart panel ───────────────────────────────────────────────
function SensorChart({ title, data, lines, events, yDomain, syncId, height=140, onHover }) {
  const handleMouseMove  = useCallback(s => { if (onHover&&s?.activeTooltipIndex!=null) onHover(s.activeTooltipIndex) }, [onHover])
  const handleMouseLeave = useCallback(() => onHover&&onHover(null), [onHover])
  return (
    <div style={{ marginBottom:2 }}>
      <div style={{ fontSize:10, color:'#555', letterSpacing:'0.12em', textTransform:'uppercase', padding:'0 4px 4px' }}>{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} syncId={syncId} margin={{ top:4, right:16, bottom:0, left:0 }}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1c" vertical={false} />
          <XAxis dataKey="ts_num" type="number" domain={['dataMin','dataMax']} tickFormatter={fmtTime} scale="time"
            tick={{ fontSize:10, fill:'#555', fontFamily:'JetBrains Mono,monospace' }} tickLine={false} axisLine={false} />
          <YAxis domain={yDomain||['auto','auto']} width={46}
            tick={{ fontSize:10, fill:'#555', fontFamily:'JetBrains Mono,monospace' }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          {lines.length>1 && <Legend wrapperStyle={{ fontSize:10, color:'#666' }} />}
          {events.map((ev,i) => <ReferenceLine key={i} x={ev.ts_num} stroke={ev.color} strokeDasharray={ev.dash||'4 3'} strokeWidth={1} strokeOpacity={0.6} />)}
          {lines.map(({key,color,name}) => (
            <Line key={key} type="monotone" dataKey={key} name={name||key} stroke={color}
              strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Control knob ──────────────────────────────────────────────
function Knob({ label, value, min, max, step, onChange, fmt }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ fontSize:9, color:'#555', fontFamily:'JetBrains Mono,monospace', width:60, textAlign:'right', letterSpacing:'0.06em' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(Number(e.target.value))}
        style={{ flex:1, accentColor:'#818cf8', cursor:'pointer', height:3 }} />
      <span style={{ fontSize:9, color:'#666', fontFamily:'JetBrains Mono,monospace', width:40 }}>{fmt?fmt(value):value}</span>
    </div>
  )
}

// ── 3D Surface canvas ─────────────────────────────────────────
// globalVmin / globalVmax = range across entire session
// so height encodes absolute rise, not just relative per-frame shape
function Surface3D({ row, spikeThreshold, azimuth, tilt, zoom, globalVmin, globalVmax, W, H }) {
  const canvasRef = useRef(null)
  const dragRef   = useRef(null)
  const [localAz, setLocalAz] = useState(azimuth)
  useEffect(()=>setLocalAz(azimuth),[azimuth])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas||!row) return
    const ctx = canvas.getContext('2d')

    let vals = Array.from({length:64},(_,i) => {
      const v = Number(row[`z${i}`])
      return (isNaN(v)||v===0) ? null : v
    })
    vals = filterSpikes(vals, spikeThreshold)

    const finite = vals.filter(v=>v!==null)
    if (!finite.length) { ctx.clearRect(0,0,W,H); return }

    // Use GLOBAL range so height is comparable across frames
    const vmin = globalVmin
    const vmax = globalVmax
    const range = vmax-vmin || 1

    const getVal = (r,c) => (r<0||r>7||c<0||c>7)?null:vals[r*8+c]
    // Lower distance = dough rose closer to sensor = taller spike
    const getH   = v => v===null ? 0 : Math.max(0, 1-(v-vmin)/range)

    const SCALE = (W/8.4)*zoom

    const project = ({x,y,z}) => {
      const cosA=Math.cos(localAz), sinA=Math.sin(localAz)
      const rx=x*cosA-y*sinA, ry=x*sinA+y*cosA
      const cosT=Math.cos(tilt), sinT=Math.sin(tilt)
      return { sx:W/2+rx*SCALE, sy:H*0.72+(ry*cosT-z*sinT)*SCALE, depth:ry*sinT+z*cosT }
    }
    const pt3 = (r,c) => { const v=getVal(r,c); return {x:(c-3.5)/4,y:(r-3.5)/4,z:getH(v)*1.6} }

    const faces=[]
    for (let r=0;r<7;r++) for (let c=0;c<7;c++) {
      const corners=[pt3(r,c),pt3(r,c+1),pt3(r+1,c+1),pt3(r+1,c)]
      const proj=corners.map(project)
      const depth=proj.reduce((s,p)=>s+p.depth,0)/4
      const vs=[getVal(r,c),getVal(r,c+1),getVal(r+1,c+1),getVal(r+1,c)].filter(v=>v!==null)
      const avgV=vs.length?vs.reduce((a,b)=>a+b,0)/vs.length:vmax
      // color also uses global range
      faces.push({ proj, depth, t:(vmax-avgV)/range, hasNull:vs.length<4 })
    }
    faces.sort((a,b)=>a.depth-b.depth)

    ctx.clearRect(0,0,W,H)
    for (const {proj:pts,t,hasNull} of faces) {
      ctx.beginPath()
      ctx.moveTo(pts[0].sx,pts[0].sy)
      for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].sx,pts[i].sy)
      ctx.closePath()
      ctx.fillStyle=hasNull?'rgba(40,40,36,0.5)':viridisColor(t)
      ctx.fill()
      ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.lineWidth=0.4; ctx.stroke()
    }

    ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=0.5
    for (let i=0;i<=7;i++) {
      const a=project({x:(i-3.5)/4,y:-3.5/4,z:0}),b=project({x:(i-3.5)/4,y:3.5/4,z:0})
      ctx.beginPath();ctx.moveTo(a.sx,a.sy);ctx.lineTo(b.sx,b.sy);ctx.stroke()
      const c=project({x:-3.5/4,y:(i-3.5)/4,z:0}),d=project({x:3.5/4,y:(i-3.5)/4,z:0})
      ctx.beginPath();ctx.moveTo(c.sx,c.sy);ctx.lineTo(d.sx,d.sy);ctx.stroke()
    }
  }, [row, localAz, tilt, zoom, spikeThreshold, globalVmin, globalVmax, W, H])

  const onMouseDown  = e => { dragRef.current={x:e.clientX,startAz:localAz} }
  const onMouseMove  = e => { if (dragRef.current) setLocalAz(dragRef.current.startAz+(e.clientX-dragRef.current.x)*0.012) }
  const onMouseUp    = () => { dragRef.current=null }

  return (
    <canvas ref={canvasRef} width={W} height={H}
      onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      style={{ cursor:'grab', display:'block', borderRadius:4, width:'100%', height:'auto' }} />
  )
}

// ── Fullscreen timeline (ToF + CO2 strip) ─────────────────────
function FullscreenTimeline({ data, events, hoveredIdx, onHover, currentRow }) {
  const handleMouseMove  = useCallback(s => { if (onHover&&s?.activeTooltipIndex!=null) onHover(s.activeTooltipIndex) }, [onHover])
  const handleMouseLeave = useCallback(() => onHover&&onHover(null), [onHover])
  const cursorX = currentRow?.ts_num ?? null

  return (
    <div style={{ borderTop:'1px solid #1a1a18', padding:'12px 0 0 0' }}>
      <div style={{ fontSize:10, color:'#555', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:6, paddingLeft:4 }}>
        ToF rise (median mm) — hover to scrub
      </div>
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={data} margin={{ top:4, right:16, bottom:0, left:0 }}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1c" vertical={false} />
          <XAxis dataKey="ts_num" type="number" domain={['dataMin','dataMax']} tickFormatter={fmtTime} scale="time"
            tick={{ fontSize:9, fill:'#555', fontFamily:'JetBrains Mono,monospace' }} tickLine={false} axisLine={false} />
          <YAxis width={46} tick={{ fontSize:9, fill:'#555', fontFamily:'JetBrains Mono,monospace' }} tickLine={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          {events.map((ev,i) => <ReferenceLine key={i} x={ev.ts_num} stroke={ev.color} strokeDasharray={ev.dash||'4 3'} strokeWidth={1} strokeOpacity={0.5} />)}
          {cursorX && <ReferenceLine x={cursorX} stroke="#ffffff" strokeWidth={1} strokeOpacity={0.3} />}
          <Line type="monotone" dataKey="tof_median_mm" name="Median" stroke={COLORS.tof}
            strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Fullscreen overlay ────────────────────────────────────────
function FullscreenView({ row, spikeThreshold, setSpikeThreshold, onClose, allEvents, sensorData, hoveredIdx, setHoveredIdx, globalVmin, globalVmax }) {
  const [azimuth, setAzimuth] = useState(-0.55)
  const [tilt,    setTilt]    = useState(0.52)
  const [zoom,    setZoom]    = useState(1.1)

  useEffect(() => {
    const h = e => { if (e.key==='Escape') onClose() }
    window.addEventListener('keydown',h)
    return ()=>window.removeEventListener('keydown',h)
  }, [onClose])

  const activeEvents = allEvents.filter(ev => {
    if (!row?.timestamp) return false
    return Math.abs(new Date(ev.ts).getTime()-new Date(row.timestamp).getTime())<60000
  })

  const metrics = row ? [
    { label:'Time',       value:fmtTime(row.timestamp),         unit:'',    color:'#888' },
    { label:'CO₂',        value:fmtVal(row.co2_ppm,0),          unit:'ppm', color:COLORS.co2 },
    { label:'Air temp',   value:fmtVal(row.air_temp_c),         unit:'°C',  color:COLORS.air_temp },
    { label:'Humidity',   value:fmtVal(row.rel_humidity_pct),   unit:'%',   color:COLORS.humidity },
    { label:'pH',         value:fmtVal(row.hanna_ph,2),         unit:'',    color:COLORS.ph },
    { label:'Hanna mV',   value:fmtVal(row.hanna_mv,1),         unit:'mV',  color:COLORS.hanna_temp },
    { label:'Hanna temp', value:fmtVal(row.hanna_temp_c),       unit:'°C',  color:COLORS.hanna_temp },
    { label:'ToF median', value:fmtVal(row.tof_median_mm,0),   unit:'mm',  color:COLORS.tof },
  ] : []

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, background:'#0a0a08', display:'flex', flexDirection:'column' }}>

      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 24px', borderBottom:'1px solid #1a1a18', background:'#0c0c0a', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <span style={{ fontSize:10, color:'#555', letterSpacing:'0.15em', textTransform:'uppercase' }}>ToF Surface</span>
          <span style={{ fontSize:13, fontFamily:'JetBrains Mono,monospace', color:'#888' }}>{fmtTime(row?.timestamp)}</span>
          {activeEvents.map((ev,i) => (
            <span key={i} style={{ fontSize:11, color:ev.color, fontFamily:'JetBrains Mono,monospace', opacity:0.85 }}>⬦ {ev.label}</span>
          ))}
        </div>
        <button onClick={onClose} style={{ background:'none', border:'1px solid #303028', color:'#666', borderRadius:4, padding:'5px 12px', fontSize:12, cursor:'pointer', fontFamily:'JetBrains Mono,monospace' }}>
          esc / close ✕
        </button>
      </div>

      {/* Body */}
      <div style={{ flex:1, display:'grid', gridTemplateColumns:'1fr 280px', overflow:'hidden' }}>

        {/* Left: surface + timeline */}
        <div style={{ display:'flex', flexDirection:'column', padding:'20px 20px 16px 24px', overflow:'auto', gap:14 }}>

          <Surface3D row={row} spikeThreshold={spikeThreshold} azimuth={azimuth} tilt={tilt} zoom={zoom}
            globalVmin={globalVmin} globalVmax={globalVmax} W={900} H={480} />

          {/* Color legend */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:100, height:5, borderRadius:3, background:'linear-gradient(to right, rgb(68,1,84), rgb(43,131,120), rgb(253,231,37))' }} />
            <span style={{ fontSize:9, color:'#555', fontFamily:'JetBrains Mono,monospace' }}>
              far ({Math.round(globalVmax)} mm) → close ({Math.round(globalVmin)} mm)
            </span>
          </div>

          {/* View controls */}
          <div style={{ display:'flex', flexDirection:'column', gap:8, maxWidth:560 }}>
            <Knob label="rotate"       value={azimuth}        min={-Math.PI} max={Math.PI} step={0.01} onChange={setAzimuth}        fmt={v=>`${Math.round(v*(180/Math.PI))}°`} />
            <Knob label="tilt"         value={tilt}           min={0.1}      max={1.3}     step={0.01} onChange={setTilt}            fmt={v=>`${Math.round(v*(180/Math.PI))}°`} />
            <Knob label="zoom"         value={zoom}           min={0.4}      max={2.5}     step={0.05} onChange={setZoom}            fmt={v=>`${v.toFixed(1)}×`} />
            <Knob label="spike filter" value={spikeThreshold} min={0}        max={300}     step={5}    onChange={setSpikeThreshold}  fmt={v=>v===0?'off':`${v} mm`} />
          </div>

          {/* Timeline scrubber */}
          <FullscreenTimeline
            data={sensorData}
            events={allEvents}
            hoveredIdx={hoveredIdx}
            onHover={setHoveredIdx}
            currentRow={row}
          />
        </div>

        {/* Right: values */}
        <div style={{ borderLeft:'1px solid #1a1a18', padding:'20px 20px', display:'flex', flexDirection:'column', gap:5, overflow:'auto' }}>
          <div style={{ fontSize:10, color:'#555', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:10 }}>Values at cursor</div>
          {metrics.map(m => (
            <div key={m.label} style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', padding:'7px 12px', borderRadius:5, background:'#111110', border:'1px solid #1c1c1a' }}>
              <span style={{ fontSize:10, color:'#555', letterSpacing:'0.08em', textTransform:'uppercase' }}>{m.label}</span>
              <span style={{ fontFamily:'JetBrains Mono,monospace', color:m.color, fontSize:16 }}>
                {m.value}{m.unit&&<span style={{ fontSize:10, color:'#444', marginLeft:3 }}>{m.unit}</span>}
              </span>
            </div>
          ))}

          {activeEvents.length>0 && (
            <div style={{ marginTop:14, borderTop:'1px solid #1a1a18', paddingTop:14 }}>
              <div style={{ fontSize:10, color:'#555', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:8 }}>Events nearby</div>
              {activeEvents.map((ev,i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, fontFamily:'JetBrains Mono,monospace', marginBottom:6 }}>
                  <div style={{ width:16, height:1, borderTop:`2px dashed ${ev.color}` }} />
                  <span style={{ color:ev.color }}>{ev.label}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop:'auto', paddingTop:16, fontSize:9, color:'#2a2a28', fontFamily:'JetBrains Mono,monospace', lineHeight:1.6 }}>
            Height ↑ = dough risen<br/>
            Scale fixed to session range<br/>
            Drag canvas to rotate
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Inline 3D panel ───────────────────────────────────────────
function Heatmap3DPanel({ row, spikeThreshold, setSpikeThreshold, onFullscreen, globalVmin, globalVmax }) {
  const [azimuth, setAzimuth] = useState(-0.55)
  const [tilt,    setTilt]    = useState(0.52)
  const [zoom,    setZoom]    = useState(1.0)

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ fontSize:10, color:'#555', letterSpacing:'0.12em', textTransform:'uppercase' }}>ToF Surface</div>
        <button onClick={onFullscreen} title="Fullscreen" style={{ background:'none', border:'1px solid #2a2820', color:'#666', borderRadius:4, padding:'3px 8px', fontSize:13, cursor:'pointer', lineHeight:1 }}>⛶</button>
      </div>

      <Surface3D row={row} spikeThreshold={spikeThreshold} azimuth={azimuth} tilt={tilt} zoom={zoom}
        globalVmin={globalVmin} globalVmax={globalVmax} W={360} H={260} />

      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:8 }}>
        <div style={{ flex:1, height:5, borderRadius:3, background:'linear-gradient(to right, rgb(68,1,84), rgb(43,131,120), rgb(253,231,37))' }} />
        <span style={{ fontSize:9, color:'#555', fontFamily:'JetBrains Mono,monospace', whiteSpace:'nowrap' }}>
          far ({Math.round(globalVmax)}mm) → close ({Math.round(globalVmin)}mm)
        </span>
      </div>

      <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:7 }}>
        <Knob label="rotate" value={azimuth} min={-Math.PI} max={Math.PI} step={0.01} onChange={setAzimuth} fmt={v=>`${Math.round(v*(180/Math.PI))}°`} />
        <Knob label="tilt"   value={tilt}    min={0.1}      max={1.3}     step={0.01} onChange={setTilt}    fmt={v=>`${Math.round(v*(180/Math.PI))}°`} />
        <Knob label="zoom"   value={zoom}    min={0.4}      max={2.5}     step={0.05} onChange={setZoom}    fmt={v=>`${v.toFixed(1)}×`} />
      </div>

      <div style={{ marginTop:14, borderTop:'1px solid #1a1a18', paddingTop:12 }}>
        <div style={{ fontSize:10, color:'#555', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8 }}>Spike filter</div>
        <Knob label="threshold" value={spikeThreshold} min={0} max={300} step={5} onChange={setSpikeThreshold} fmt={v=>v===0?'off':`${v} mm`} />
        <div style={{ fontSize:9, color:'#383830', fontFamily:'JetBrains Mono,monospace', marginTop:6, lineHeight:1.5 }}>
          Zones deviating more than this<br/>from neighbours are hidden.
        </div>
      </div>
    </div>
  )
}

// ── Event legend ──────────────────────────────────────────────
function EventLegend({ events }) {
  if (!events.length) return <div style={{ fontSize:11, color:'#444', fontFamily:'JetBrains Mono,monospace' }}>No events recorded</div>
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <div style={{ fontSize:10, color:'#555', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:2 }}>Events</div>
      {events.map((ev,i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:8, fontSize:11, fontFamily:'JetBrains Mono,monospace' }}>
          <div style={{ width:20, height:1, borderTop:`2px dashed ${ev.color}`, opacity:0.8 }} />
          <span style={{ color:ev.color, opacity:0.9 }}>{ev.label}</span>
          <span style={{ color:'#555', fontSize:10 }}>{fmtTime(ev.ts)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────
export default function Dashboard() {
  const [sessions,       setSessions]       = useState([])
  const [sessionId,      setSessionId]      = useState(null)
  const [sensorData,     setSensorData]     = useState([])
  const [kbdEvents,      setKbdEvents]      = useState([])
  const [rfidEvents,     setRfidEvents]     = useState([])
  const [live,           setLive]           = useState(false)
  const [loading,        setLoading]        = useState(false)
  const [hoveredIdx,     setHoveredIdx]     = useState(null)
  const [spikeThreshold, setSpikeThreshold] = useState(60)
  const [fullscreen,     setFullscreen]     = useState(false)
  const subRef = useRef(null)

  useEffect(() => {
    supabase.from('combined_log').select('session_id,session_name').order('session_id',{ascending:false})
      .then(({ data }) => {
        if (!data) return
        const seen=new Set()
        const uniq=data.filter(r=>{ if(seen.has(r.session_id)) return false; seen.add(r.session_id); return true })
        setSessions(uniq)
        if (uniq.length) setSessionId(uniq[0].session_id)
      })
  }, [])

  const loadData = useCallback(async sid => {
    if (!sid) return
    setLoading(true)
    const [logRes,kbdRes,rfidRes] = await Promise.all([
      supabase.from('combined_log').select('*').eq('session_id',sid).order('timestamp',{ascending:true}),
      supabase.from('keyboard_events').select('*').eq('session_id',sid).order('timestamp',{ascending:true}),
      supabase.from('rfid_events').select('*').eq('session_id',sid).order('timestamp',{ascending:true}),
    ])
    setSensorData((logRes.data||[]).map(r=>({...r,ts_num:new Date(r.timestamp).getTime()})))
    setKbdEvents(kbdRes.data||[])
    setRfidEvents(rfidRes.data||[])
    setLoading(false)
  }, [])

  useEffect(() => { if (sessionId) loadData(sessionId) }, [sessionId,loadData])

  useEffect(() => {
    if (subRef.current) { supabase.removeChannel(subRef.current); subRef.current=null }
    if (!live||!sessionId) return
    const ch=supabase.channel('live-log')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'combined_log',   filter:`session_id=eq.${sessionId}`}, p=>setSensorData(prev=>[...prev,{...p.new,ts_num:new Date(p.new.timestamp).getTime()}]))
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'keyboard_events',filter:`session_id=eq.${sessionId}`}, p=>setKbdEvents(prev=>[...prev,p.new]))
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'rfid_events',    filter:`session_id=eq.${sessionId}`}, p=>setRfidEvents(prev=>[...prev,p.new]))
      .subscribe()
    subRef.current=ch
    return ()=>{ supabase.removeChannel(ch); subRef.current=null }
  }, [live,sessionId])

  // Global ToF range across entire session — so surface height is absolute
  const { globalVmin, globalVmax } = useMemo(() => {
    if (!sensorData.length) return { globalVmin:0, globalVmax:1 }
    const allZoneVals = []
    for (const row of sensorData) {
      for (let i=0; i<64; i++) {
        const v = Number(row[`z${i}`])
        if (!isNaN(v) && v>0) allZoneVals.push(v)
      }
    }
    if (!allZoneVals.length) return { globalVmin:0, globalVmax:1 }
    // use percentiles to avoid extreme outliers skewing the scale
    allZoneVals.sort((a,b)=>a-b)
    return {
      globalVmin: allZoneVals[Math.floor(allZoneVals.length*0.02)],
      globalVmax: allZoneVals[Math.floor(allZoneVals.length*0.98)],
    }
  }, [sensorData])

  const allEvents = [
    ...kbdEvents.map(e  =>({ ts:e.timestamp, ts_num:new Date(e.timestamp).getTime(), label:e.text||e.event_type||'key',             color:COLORS.kbd_event,  dash:'5 3' })),
    ...rfidEvents.map(e =>({ ts:e.timestamp, ts_num:new Date(e.timestamp).getTime(), label:e.event_name||e.tag_id?.slice(-6)||'rfid', color:e.status==='known'?COLORS.rfid_known:COLORS.rfid_unk, dash:'2 3' })),
  ].sort((a,b)=>a.ts_num-b.ts_num)

  const latest       = sensorData[sensorData.length-1]||null
  const displayRow   = hoveredIdx!=null ? sensorData[hoveredIdx] : latest
  const sessionLabel = sessions.find(s=>s.session_id===sessionId)?.session_name||sessionId
  const chartProps   = { data:sensorData, events:allEvents, syncId:'sourdough', onHover:setHoveredIdx }

  return (
    <>
      {fullscreen && (
        <FullscreenView
          row={displayRow}
          spikeThreshold={spikeThreshold}
          setSpikeThreshold={setSpikeThreshold}
          onClose={()=>setFullscreen(false)}
          allEvents={allEvents}
          sensorData={sensorData}
          hoveredIdx={hoveredIdx}
          setHoveredIdx={setHoveredIdx}
          globalVmin={globalVmin}
          globalVmax={globalVmax}
        />
      )}

      <div style={{ background:'#0c0c0a', minHeight:'100vh', color:'#d4cfc8', fontFamily:"'Barlow',sans-serif", padding:'20px 24px' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={{ fontSize:11, color:'#555', letterSpacing:'0.2em', textTransform:'uppercase' }}>Sourdough Monitor</div>
            <div style={{ fontSize:22, fontWeight:600, color:'#e8e0d0', marginTop:2 }}>{sessionLabel}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <select value={sessionId||''} onChange={e=>setSessionId(e.target.value)}
              style={{ background:'#111110', border:'1px solid #2a2820', color:'#d4cfc8', borderRadius:4, padding:'6px 10px', fontSize:12, fontFamily:'JetBrains Mono,monospace', outline:'none', cursor:'pointer' }}>
              {sessions.map(s=><option key={s.session_id} value={s.session_id}>{s.session_name} ({s.session_id})</option>)}
            </select>
            <button onClick={()=>loadData(sessionId)} disabled={loading}
              style={{ background:'#1a1a16', border:'1px solid #2a2820', color:'#888', borderRadius:4, padding:'6px 12px', fontSize:11, cursor:'pointer', fontFamily:'JetBrains Mono,monospace' }}>
              {loading?'…':'↺ Refresh'}
            </button>
            <button onClick={()=>setLive(l=>!l)}
              style={{ background:live?'#1a2e1a':'#1a1a16', border:`1px solid ${live?'#34d399':'#2a2820'}`, color:live?'#34d399':'#555', borderRadius:4, padding:'6px 12px', fontSize:11, cursor:'pointer', fontFamily:'JetBrains Mono,monospace' }}>
              {live?'⦿ Live':'○ Live'}
            </button>
          </div>
        </div>

        {/* Stats */}
        {latest && (
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:24 }}>
            <Stat label="CO₂"        value={fmtVal(latest.co2_ppm,0)}       unit="ppm" color={COLORS.co2} />
            <Stat label="Air temp"   value={fmtVal(latest.air_temp_c)}       unit="°C"  color={COLORS.air_temp} />
            <Stat label="Humidity"   value={fmtVal(latest.rel_humidity_pct)} unit="%"   color={COLORS.humidity} />
            {latest.hanna_ph!=null && <Stat label="pH" value={fmtVal(latest.hanna_ph,2)} unit="" color={COLORS.ph} />}
            <Stat label="Rise (ToF)" value={fmtVal(latest.tof_median_mm,0)} unit="mm"  color={COLORS.tof} />
            <Stat label="Frames"     value={sensorData.length}               unit="rows" color="#555" />
            {hoveredIdx!=null && <Stat label="Scrubbing" value={fmtTime(sensorData[hoveredIdx]?.timestamp)} unit="" color="#a0a0a0" />}
          </div>
        )}

        {loading&&!sensorData.length && (
          <div style={{ color:'#555', fontSize:12, fontFamily:'JetBrains Mono,monospace', padding:'40px 0', textAlign:'center' }}>loading…</div>
        )}

        {sensorData.length>0 && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 400px', gap:20, alignItems:'start' }}>

            {/* Charts */}
            <div style={{ background:'#111110', border:'1px solid #1e1e1c', borderRadius:8, padding:'16px 12px' }}>
              <SensorChart title="CO₂ (ppm)" lines={[{key:'co2_ppm',color:COLORS.co2,name:'CO₂'}]} {...chartProps} height={130} />
              <div style={{ borderTop:'1px solid #1a1a18', margin:'8px 0' }} />
              <SensorChart title="Temperature (°C)" lines={[
                {key:'air_temp_c',  color:COLORS.air_temp,  name:'Air'},
                {key:'hanna_temp_c',color:COLORS.hanna_temp,name:'Hanna'},
              ]} {...chartProps} height={150} />
              <div style={{ borderTop:'1px solid #1a1a18', margin:'8px 0' }} />
              <SensorChart title="Humidity (%)" lines={[{key:'rel_humidity_pct',color:COLORS.humidity,name:'RH'}]} {...chartProps} height={110} />
              <div style={{ borderTop:'1px solid #1a1a18', margin:'8px 0' }} />
              <SensorChart title="pH" lines={[{key:'hanna_ph',color:COLORS.ph,name:'pH'}]} yDomain={[0,14]} {...chartProps} height={110} />
              <div style={{ borderTop:'1px solid #1a1a18', margin:'8px 0' }} />
              {/* Median only — min/max removed */}
              <SensorChart title="ToF Rise (mm)" lines={[
                {key:'tof_median_mm', color:COLORS.tof, name:'Median'},
              ]} {...chartProps} height={130} />
            </div>

            {/* Sidebar */}
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ background:'#111110', border:`1px solid ${hoveredIdx!=null?'#303028':'#1e1e1c'}`, borderRadius:8, padding:16, transition:'border-color 0.1s' }}>
                <Heatmap3DPanel
                  row={displayRow}
                  spikeThreshold={spikeThreshold}
                  setSpikeThreshold={setSpikeThreshold}
                  onFullscreen={()=>setFullscreen(true)}
                  globalVmin={globalVmin}
                  globalVmax={globalVmax}
                />
              </div>
              <div style={{ background:'#111110', border:'1px solid #1e1e1c', borderRadius:8, padding:16 }}>
                <EventLegend events={allEvents} />
              </div>
            </div>

          </div>
        )}
      </div>
    </>
  )
}
