import React, { useRef, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import jsPDF from 'jspdf';

const TrussDrawer = () => {
  const canvasRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const [members, setMembers] = useState([]);
  const [forces, setForces] = useState([]);
  const [supports, setSupports] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('nodes');

  // Node input
  const [nX, setNX] = useState('');
  const [nY, setNY] = useState('');

  // Member input
  const [mFrom, setMFrom] = useState('');
  const [mTo, setMTo] = useState('');

  // Force input
  const [fNode, setFNode] = useState('');
  const [fX, setFX] = useState('0');
  const [fY, setFY] = useState('');

  // Support input
  const [sNode, setSNode] = useState('');
  const [sType, setSType] = useState('pin');

  // Material
  const [matE, setMatE] = useState('200');
  const [matA, setMatA] = useState('0.01');

  // ── Canvas scale: real coordinates → canvas pixels ──────────────────────
  const CANVAS_W = 820;
  const CANVAS_H = 460;
  const PAD = 60;

  const toCanvas = useCallback((nodes) => {
    if (nodes.length === 0) return { cx: n => n.x, cy: n => n.y, scale: 1 };
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scaleX = (CANVAS_W - PAD * 2) / rangeX;
    const scaleY = (CANVAS_H - PAD * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = PAD + ((CANVAS_W - PAD * 2) - rangeX * scale) / 2;
    const offsetY = PAD + ((CANVAS_H - PAD * 2) - rangeY * scale) / 2;
    return {
      cx: n => offsetX + (n.x - minX) * scale,
      cy: n => CANVAS_H - (offsetY + (n.y - minY) * scale), // flip Y axis
      scale
    };
  }, []);

  // ── DRAW ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Background
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = '#ececec';
    ctx.lineWidth = 0.8;
    for (let x = 0; x <= CANVAS_W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }

    if (nodes.length === 0) {
      ctx.fillStyle = '#b0bec5';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Enter node coordinates on the left to build your truss', CANVAS_W / 2, CANVAS_H / 2);
      ctx.textAlign = 'left';
      return;
    }

    const { cx, cy } = toCanvas(nodes);

    // Original members (dashed gray)
    ctx.setLineDash([6, 3]);
    ctx.strokeStyle = '#b0bec5';
    ctx.lineWidth = 1.5;
    members.forEach(m => {
      const n1 = nodes.find(n => n.id === m.node1);
      const n2 = nodes.find(n => n.id === m.node2);
      if (!n1 || !n2) return;
      ctx.beginPath();
      ctx.moveTo(cx(n1), cy(n1));
      ctx.lineTo(cx(n2), cy(n2));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#78909c';
      ctx.font = '10px sans-serif';
      ctx.fillText(m.id, (cx(n1) + cx(n2)) / 2 + 4, (cy(n1) + cy(n2)) / 2 - 5);
      ctx.setLineDash([6, 3]);
    });
    ctx.setLineDash([]);

    // Deformed + colored members after solve
    if (results && results.success) {
      const dispScale = 200;
      members.forEach(m => {
        const n1 = nodes.find(n => n.id === m.node1);
        const n2 = nodes.find(n => n.id === m.node2);
        if (!n1 || !n2) return;
        const mf = results.member_forces[m.id];
        if (!mf) return;
        const u1 = results.displacements[String(n1.id)] || { ux: 0, uy: 0 };
        const u2 = results.displacements[String(n2.id)] || { ux: 0, uy: 0 };
        const { cx: cxD, cy: cyD } = toCanvas(nodes);
        const x1d = cxD(n1) + u1.ux * dispScale;
        const y1d = cyD(n1) - u1.uy * dispScale;
        const x2d = cxD(n2) + u2.ux * dispScale;
        const y2d = cyD(n2) - u2.uy * dispScale;
        ctx.strokeStyle = mf.type === 'TENSION' ? '#e53e3e' : '#3182ce';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x1d, y1d);
        ctx.lineTo(x2d, y2d);
        ctx.stroke();
        ctx.fillStyle = mf.type === 'TENSION' ? '#c53030' : '#2b6cb0';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(
          `${(mf.force / 1000).toFixed(1)}kN`,
          (x1d + x2d) / 2 + 4, (y1d + y2d) / 2 - 7
        );
      });
    }

    // Supports
    supports.forEach(s => {
      const n = nodes.find(nd => nd.id === s.node_id);
      if (!n) return;
      const px = cx(n), py = cy(n);
      ctx.strokeStyle = '#2b6cb0';
      ctx.fillStyle = '#2b6cb0';
      ctx.lineWidth = 2;
      if (s.type === 'pin') {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 13, py + 22);
        ctx.lineTo(px + 13, py + 22);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px - 16, py + 24);
        ctx.lineTo(px + 16, py + 24);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - 13, py + 22);
        ctx.lineTo(px + 13, py + 22);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px - 8, py + 28, 4, 0, Math.PI * 2);
        ctx.arc(px + 8, py + 28, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = '10px sans-serif';
      ctx.fillText(s.type === 'pin' ? 'PIN' : 'ROLLER', px - 12, py + 42);
    });

    // Force arrows
    forces.forEach(f => {
      const n = nodes.find(nd => nd.id === f.node_id);
      if (!n) return;
      const px = cx(n), py = cy(n);
      ctx.strokeStyle = '#276749';
      ctx.fillStyle = '#276749';
      ctx.lineWidth = 2.5;
      const sc = 0.3;
      const totalF = Math.sqrt(f.fx * f.fx + f.fy * f.fy);
      const arrowLen = 50;
      const ex = totalF > 0 ? px + (f.fx / totalF) * arrowLen : px;
      const ey = totalF > 0 ? py - (f.fy / totalF) * arrowLen : py + arrowLen;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      const ang = Math.atan2(ey - py, ex - px);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 12 * Math.cos(ang - 0.4), ey - 12 * Math.sin(ang - 0.4));
      ctx.lineTo(ex - 12 * Math.cos(ang + 0.4), ey - 12 * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#276749';
      ctx.fillText(`${Math.abs(f.fy / 1000).toFixed(0)}kN`, px + 8, py - 12);
    });

    // Nodes (always on top)
    nodes.forEach(n => {
      const px = cx(n), py = cy(n);
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      ctx.beginPath();
      ctx.arc(px + 1, py + 1, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = results ? '#c53030' : '#3182ce';
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Node ID inside circle
      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.id, px, py + 4);
      ctx.textAlign = 'left';
      // Coordinates label
      ctx.fillStyle = '#455a64';
      ctx.font = '10px sans-serif';
      ctx.fillText(`(${n.x}, ${n.y})`, px + 11, py - 8);
    });

    // Axis labels
    ctx.fillStyle = '#90a4ae';
    ctx.font = '11px sans-serif';
    ctx.fillText('X →', CANVAS_W - 35, CANVAS_H - 8);
    ctx.fillText('↑ Y', 6, 20);

  }, [nodes, members, forces, supports, results, toCanvas]);

  useEffect(() => { draw(); }, [draw]);

  // ── ADD NODE ─────────────────────────────────────────────────────────────
  const handleAddNode = () => {
    const x = parseFloat(nX);
    const y = parseFloat(nY);
    if (isNaN(x) || isNaN(y)) { setError('Enter valid X and Y coordinates'); return; }
    const duplicate = nodes.find(n => n.x === x && n.y === y);
    if (duplicate) { setError(`A node already exists at (${x}, ${y})`); return; }
    setNodes(prev => [...prev, { id: prev.length, x, y }]);
    setNX(''); setNY('');
    setError('');
  };

  // ── ADD MEMBER ────────────────────────────────────────────────────────────
  const handleAddMember = () => {
    const n1 = parseInt(mFrom);
    const n2 = parseInt(mTo);
    if (isNaN(n1) || isNaN(n2)) { setError('Enter valid node IDs'); return; }
    if (n1 === n2) { setError('Cannot connect a node to itself'); return; }
    if (!nodes.find(n => n.id === n1)) { setError(`Node ${n1} does not exist`); return; }
    if (!nodes.find(n => n.id === n2)) { setError(`Node ${n2} does not exist`); return; }
    const exists = members.find(m =>
      (m.node1 === n1 && m.node2 === n2) || (m.node1 === n2 && m.node2 === n1)
    );
    if (exists) { setError(`Member between ${n1} and ${n2} already exists`); return; }
    setMembers(prev => [...prev, { id: `M${prev.length + 1}`, node1: n1, node2: n2 }]);
    setMFrom(''); setMTo('');
    setError('');
  };

  // ── ADD FORCE ─────────────────────────────────────────────────────────────
  const handleAddForce = () => {
    const nid = parseInt(fNode);
    const fx = parseFloat(fX) || 0;
    const fy = parseFloat(fY);
    if (isNaN(nid)) { setError('Enter valid node ID'); return; }
    if (isNaN(fy) && isNaN(fx)) { setError('Enter at least one force value'); return; }
    if (!nodes.find(n => n.id === nid)) { setError(`Node ${nid} does not exist`); return; }
    setForces(prev => [...prev, { node_id: nid, fx, fy: isNaN(fy) ? 0 : fy }]);
    setFNode(''); setFX('0'); setFY('');
    setError('');
  };

  // ── ADD SUPPORT ───────────────────────────────────────────────────────────
  const handleAddSupport = () => {
    const nid = parseInt(sNode);
    if (isNaN(nid)) { setError('Enter valid node ID'); return; }
    if (!nodes.find(n => n.id === nid)) { setError(`Node ${nid} does not exist`); return; }
    const exists = supports.find(s => s.node_id === nid);
    if (exists) { setError(`Node ${nid} already has a support`); return; }
    setSupports(prev => [...prev, { node_id: nid, type: sType }]);
    setSNode('');
    setError('');
  };

  // ── SOLVE ─────────────────────────────────────────────────────────────────
  const handleSolve = async () => {
    setError('');
    if (nodes.length < 2)    { setError('Add at least 2 nodes'); return; }
    if (members.length < 1)  { setError('Add at least 1 member'); return; }
    if (supports.length < 1) { setError('Add at least 2 supports (pin + roller)'); return; }
    if (forces.length < 1)   { setError('Add at least 1 force'); return; }
    setLoading(true);
    try {
      const response = await axios.post('http://localhost:5000/api/analyze', {
        nodes, members, forces, supports,
        E: parseFloat(matE) * 1e9,
        A: parseFloat(matA)
      });
      if (response.data.success) {
        setResults(response.data);
        setActiveTab('results');
      } else {
        setError(response.data.error || 'Analysis failed');
      }
    } catch {
      setError('Cannot connect to backend. Make sure Flask is running on port 5000.');
    }
    setLoading(false);
  };

  // ── CLEAR ─────────────────────────────────────────────────────────────────
  const handleClear = () => {
    if (!window.confirm('Clear everything and start over?')) return;
    setNodes([]); setMembers([]); setForces([]);
    setSupports([]); setResults(null); setError('');
    setActiveTab('nodes');
  };

  // ── LOAD EXAMPLE ──────────────────────────────────────────────────────────
  const loadExample = (type) => {
    setResults(null); setError('');
    if (type === 'triangle') {
      setNodes([
        { id: 0, x: 0,  y: 0 },
        { id: 1, x: 5,  y: 4 },
        { id: 2, x: 10, y: 0 }
      ]);
      setMembers([
        { id: 'M1', node1: 0, node2: 1 },
        { id: 'M2', node1: 1, node2: 2 },
        { id: 'M3', node1: 0, node2: 2 }
      ]);
      setSupports([
        { node_id: 0, type: 'pin' },
        { node_id: 2, type: 'roller_y' }
      ]);
      setForces([{ node_id: 1, fx: 0, fy: -50000 }]);
    } else if (type === 'warren') {
      setNodes([
        { id: 0, x: 0,  y: 0 },
        { id: 1, x: 5,  y: 4 },
        { id: 2, x: 10, y: 0 },
        { id: 3, x: 15, y: 4 },
        { id: 4, x: 20, y: 0 },
        { id: 5, x: 25, y: 4 },
        { id: 6, x: 30, y: 0 }
      ]);
      setMembers([
        { id: 'TC1', node1: 1, node2: 3 },
        { id: 'TC2', node1: 3, node2: 5 },
        { id: 'BC1', node1: 0, node2: 2 },
        { id: 'BC2', node1: 2, node2: 4 },
        { id: 'BC3', node1: 4, node2: 6 },
        { id: 'D1',  node1: 0, node2: 1 },
        { id: 'D2',  node1: 1, node2: 2 },
        { id: 'D3',  node1: 2, node2: 3 },
        { id: 'D4',  node1: 3, node2: 4 },
        { id: 'D5',  node1: 4, node2: 5 },
        { id: 'D6',  node1: 5, node2: 6 }
      ]);
      setSupports([
        { node_id: 0, type: 'pin' },
        { node_id: 6, type: 'roller_y' }
      ]);
      setForces([
        { node_id: 2, fx: 0, fy: -80000 },
        { node_id: 4, fx: 0, fy: -80000 }
      ]);
    }
    setActiveTab('nodes');
  };

  // ── SAVE / LOAD ───────────────────────────────────────────────────────────
  const saveProject = () => {
    const name = window.prompt('Enter project name:');
    if (!name) return;
    localStorage.setItem(`truss_${name}`, JSON.stringify({ nodes, members, forces, supports, matE, matA }));
    alert(`✅ Saved as "${name}"`);
  };

  const loadProject = () => {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('truss_'));
    if (keys.length === 0) { alert('No saved projects found'); return; }
    const names = keys.map(k => k.replace('truss_', '')).join('\n');
    const name = window.prompt(`Saved projects:\n${names}\n\nEnter name to load:`);
    if (!name) return;
    const data = localStorage.getItem(`truss_${name}`);
    if (!data) { alert('Not found'); return; }
    const p = JSON.parse(data);
    setNodes(p.nodes || []); setMembers(p.members || []);
    setForces(p.forces || []); setSupports(p.supports || []);
    setMatE(p.matE || '200'); setMatA(p.matA || '0.01');
    setResults(null);
  };

  // ── PDF ───────────────────────────────────────────────────────────────────
  const downloadPDF = () => {
    if (!results) { alert('Solve the truss first!'); return; }
    const pdf = new jsPDF();
    const date = new Date().toLocaleDateString();
    pdf.setFillColor(43, 108, 176);
    pdf.rect(0, 0, 210, 28, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(18); pdf.setFont(undefined, 'bold');
    pdf.text('TRUSS ANALYSIS REPORT', 14, 13);
    pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
    pdf.text(`Date: ${date}  |  Nodes: ${nodes.length}  |  Members: ${members.length}  |  E: ${matE} GPa  |  A: ${matA} m²`, 14, 22);
    pdf.setTextColor(0, 0, 0);

    // Node table
    pdf.setFontSize(13); pdf.setFont(undefined, 'bold');
    pdf.text('Node Coordinates', 14, 38);
    pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
    pdf.setFillColor(237, 242, 247);
    pdf.rect(14, 42, 182, 7, 'F');
    pdf.setFont(undefined, 'bold');
    pdf.text('Node', 16, 48); pdf.text('X (m)', 50, 48);
    pdf.text('Y (m)', 90, 48); pdf.text('UX (m)', 130, 48); pdf.text('UY (m)', 165, 48);
    pdf.setFont(undefined, 'normal');
    let y = 58;
    nodes.forEach(n => {
      const d = results.displacements[String(n.id)] || { ux: 0, uy: 0 };
      pdf.text(String(n.id), 16, y); pdf.text(String(n.x), 50, y);
      pdf.text(String(n.y), 90, y);
      pdf.text(d.ux.toExponential(2), 130, y);
      pdf.text(d.uy.toExponential(2), 165, y);
      y += 8;
    });

    // Member forces table
    y += 6;
    pdf.setFontSize(13); pdf.setFont(undefined, 'bold');
    pdf.text('Member Force Results', 14, y); y += 8;
    pdf.setFontSize(10);
    pdf.setFillColor(237, 242, 247);
    pdf.rect(14, y, 182, 7, 'F');
    pdf.text('Member', 16, y + 6); pdf.text('Nodes', 50, y + 6);
    pdf.text('Force (kN)', 90, y + 6); pdf.text('Type', 135, y + 6);
    pdf.text('Stress (MPa)', 163, y + 6);
    y += 14;
    pdf.setFont(undefined, 'normal');
    Object.entries(results.member_forces).forEach(([id, data]) => {
      if (y > 270) { pdf.addPage(); y = 20; }
      const mem = members.find(m => m.id === id);
      const isTen = data.type === 'TENSION';
      pdf.setFillColor(isTen ? 255 : 235, isTen ? 245 : 248, isTen ? 245 : 255);
      pdf.rect(14, y - 5, 182, 8, 'F');
      pdf.text(id, 16, y);
      pdf.text(mem ? `${mem.node1}→${mem.node2}` : '-', 50, y);
      pdf.setTextColor(isTen ? 197 : 43, isTen ? 48 : 108, isTen ? 48 : 176);
      pdf.setFont(undefined, 'bold');
      pdf.text((data.force / 1000).toFixed(3), 90, y);
      pdf.text(data.type, 135, y);
      pdf.setTextColor(0, 0, 0); pdf.setFont(undefined, 'normal');
      pdf.text((data.stress / 1e6).toFixed(3), 163, y);
      y += 10;
    });
    pdf.setFontSize(9); pdf.setTextColor(150, 150, 150);
    pdf.text('Generated by Online Truss Analyzer', 14, 285);
    pdf.save('truss-analysis.pdf');
  };

  // ── STYLES ────────────────────────────────────────────────────────────────
  const S = {
    page:     { display: 'flex', fontFamily: "'Segoe UI', sans-serif", backgroundColor: '#eceff1', minHeight: '100vh' },
    sidebar:  { width: 290, backgroundColor: '#1a202c', color: '#e2e8f0', display: 'flex', flexDirection: 'column', minHeight: '100vh', flexShrink: 0 },
    sideHead: { padding: '18px 16px 12px', borderBottom: '1px solid #2d3748' },
    logo:     { fontSize: 20, fontWeight: 800, color: '#63b3ed', marginBottom: 2 },
    sub:      { fontSize: 11, color: '#718096' },
    tabBar:   { display: 'flex', borderBottom: '1px solid #2d3748', backgroundColor: '#171e2b' },
    tab:      { flex: 1, padding: '10px 2px', fontSize: 10, cursor: 'pointer', textAlign: 'center', border: 'none', backgroundColor: 'transparent', color: '#718096', fontWeight: 600, letterSpacing: 0.3 },
    tabOn:    { color: '#63b3ed', borderBottom: '2px solid #63b3ed', backgroundColor: '#1a202c' },
    scroll:   { flex: 1, overflowY: 'auto', padding: '14px 14px 0' },
    sec:      { marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #2d3748' },
    secT:     { fontSize: 11, fontWeight: 700, color: '#90cdf4', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
    label:    { fontSize: 11, color: '#a0aec0', display: 'block', marginBottom: 3 },
    inp:      { width: '100%', padding: '7px 10px', border: '1px solid #2d3748', borderRadius: 6, fontSize: 12, backgroundColor: '#2d3748', color: '#e2e8f0', boxSizing: 'border-box', marginBottom: 6, outline: 'none' },
    row:      { display: 'flex', gap: 6 },
    btn:      { padding: '8px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, transition: 'opacity 0.2s' },
    full:     { width: '100%', marginBottom: 6 },
    blue:     { backgroundColor: '#3182ce', color: 'white' },
    green:    { backgroundColor: '#276749', color: 'white' },
    red:      { backgroundColor: '#c53030', color: 'white' },
    gray:     { backgroundColor: '#4a5568', color: 'white' },
    purple:   { backgroundColor: '#553c9a', color: 'white' },
    hint:     { fontSize: 10, color: '#4a5568', marginBottom: 6, lineHeight: 1.5 },
    list:     { fontSize: 11, color: '#a0aec0', maxHeight: 100, overflowY: 'auto', lineHeight: 2, backgroundColor: '#171e2b', borderRadius: 6, padding: '6px 10px', marginBottom: 6 },
    foot:     { padding: '12px 14px 16px', borderTop: '1px solid #2d3748' },
    solve:    { width: '100%', padding: '13px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 15, fontWeight: 800, backgroundColor: '#276749', color: 'white', marginBottom: 8 },
    main:     { flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 },
    card:     { backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 2px 10px rgba(0,0,0,0.07)' },
    cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    cardT:    { fontWeight: 700, fontSize: 15, color: '#2d3748' },
    legend:   { display: 'flex', gap: 20, marginTop: 10, fontSize: 12, color: '#718096', flexWrap: 'wrap' },
    errBox:   { backgroundColor: '#fff5f5', border: '1px solid #fed7d7', borderRadius: 8, padding: '10px 14px', color: '#c53030', fontSize: 13 },
    summRow:  { display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
    sumCard:  { borderRadius: 8, padding: '10px 16px', minWidth: 110 },
    table:    { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th:       { backgroundColor: '#edf2f7', padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase' },
    td:       { padding: '8px 12px', borderBottom: '1px solid #e2e8f0' },
    tag:      { display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 },
  };

  const tabStyle = t => ({ ...S.tab, ...(activeTab === t ? S.tabOn : {}) });

  return (
    <div style={S.page}>

      {/* ══════ SIDEBAR ══════ */}
      <div style={S.sidebar}>
        <div style={S.sideHead}>
          <div style={S.logo}>🌉 Truss Analyzer</div>
          <div style={S.sub}>Type coordinates — no guessing!</div>
        </div>

        {/* Tab bar */}
        <div style={S.tabBar}>
          {[
            ['nodes',   '📍 Nodes'],
            ['members', '🔗 Members'],
            ['loads',   '⬇️ Loads'],
            ['material','⚙️ Material'],
          ].map(([t, label]) => (
            <button key={t} style={tabStyle(t)} onClick={() => setActiveTab(t)}>{label}</button>
          ))}
        </div>

        <div style={S.scroll}>

          {/* ── NODES TAB ── */}
          {activeTab === 'nodes' && (
            <>
              <div style={S.sec}>
                <div style={S.secT}>Add Node by Coordinates</div>
                <div style={S.hint}>
                  Enter real-world coordinates in metres.<br />
                  Example: Node at 5m along X, 3m height → X=5, Y=3
                </div>
                <label style={S.label}>X coordinate (m)</label>
                <input style={S.inp} type="number" placeholder="e.g. 0" value={nX}
                  onChange={e => setNX(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && document.getElementById('addNodeBtn').click()} />
                <label style={S.label}>Y coordinate (m)</label>
                <input style={S.inp} type="number" placeholder="e.g. 0" value={nY}
                  onChange={e => setNY(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && document.getElementById('addNodeBtn').click()} />
                <button id="addNodeBtn" style={{ ...S.btn, ...S.blue, ...S.full }} onClick={handleAddNode}>
                  + Add Node (ID will be {nodes.length})
                </button>
              </div>

              <div style={S.sec}>
                <div style={S.secT}>Nodes Added ({nodes.length})</div>
                <div style={S.list}>
                  {nodes.length === 0
                    ? <span style={{ color: '#4a5568' }}>No nodes yet</span>
                    : nodes.map(n => <div key={n.id}>Node {n.id}: X={n.x}m, Y={n.y}m</div>)
                  }
                </div>
                {nodes.length > 0 && (
                  <button style={{ ...S.btn, ...S.red, ...S.full, fontSize: 11 }}
                    onClick={() => {
                      const last = nodes[nodes.length - 1].id;
                      setNodes(p => p.slice(0, -1));
                      setMembers(p => p.filter(m => m.node1 !== last && m.node2 !== last));
                      setForces(p => p.filter(f => f.node_id !== last));
                      setSupports(p => p.filter(s => s.node_id !== last));
                    }}>↩ Remove Last Node</button>
                )}
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={S.secT}>Load Example Truss</div>
                <div style={S.row}>
                  <button style={{ ...S.btn, ...S.gray, flex: 1 }} onClick={() => loadExample('triangle')}>△ Triangle</button>
                  <button style={{ ...S.btn, ...S.gray, flex: 1 }} onClick={() => loadExample('warren')}>〰 Warren</button>
                </div>
              </div>
            </>
          )}

          {/* ── MEMBERS TAB ── */}
          {activeTab === 'members' && (
            <>
              <div style={S.sec}>
                <div style={S.secT}>Connect Nodes with Members</div>
                <div style={S.hint}>
                  Enter the IDs of two nodes to connect them.<br />
                  Members are the structural bars of your truss.
                </div>
                <label style={S.label}>From Node ID</label>
                <input style={S.inp} type="number" placeholder="e.g. 0" value={mFrom} onChange={e => setMFrom(e.target.value)} />
                <label style={S.label}>To Node ID</label>
                <input style={S.inp} type="number" placeholder="e.g. 1" value={mTo} onChange={e => setMTo(e.target.value)} />
                <button style={{ ...S.btn, ...S.blue, ...S.full }} onClick={handleAddMember}>
                  + Add Member
                </button>
              </div>
              <div style={S.sec}>
                <div style={S.secT}>Members Added ({members.length})</div>
                <div style={S.list}>
                  {members.length === 0
                    ? <span style={{ color: '#4a5568' }}>No members yet</span>
                    : members.map(m => <div key={m.id}>{m.id}: Node {m.node1} ↔ Node {m.node2}</div>)
                  }
                </div>
                {members.length > 0 && (
                  <button style={{ ...S.btn, ...S.red, ...S.full, fontSize: 11 }}
                    onClick={() => setMembers(p => p.slice(0, -1))}>↩ Remove Last Member</button>
                )}
              </div>
            </>
          )}

          {/* ── LOADS TAB ── */}
          {activeTab === 'loads' && (
            <>
              <div style={S.sec}>
                <div style={S.secT}>Apply Force at Node</div>
                <div style={S.hint}>
                  Fy negative = downward (gravity direction).<br />
                  Fx positive = rightward.<br />
                  Example: 50 kN down = Fy = -50000
                </div>
                <label style={S.label}>Node ID</label>
                <input style={S.inp} type="number" placeholder="e.g. 1" value={fNode} onChange={e => setFNode(e.target.value)} />
                <label style={S.label}>Fx — Horizontal force (N)</label>
                <input style={S.inp} type="number" placeholder="0 (no horizontal force)" value={fX} onChange={e => setFX(e.target.value)} />
                <label style={S.label}>Fy — Vertical force (N)</label>
                <input style={S.inp} type="number" placeholder="e.g. -50000 (downward)" value={fY} onChange={e => setFY(e.target.value)} />
                <button style={{ ...S.btn, ...S.blue, ...S.full }} onClick={handleAddForce}>+ Apply Force</button>
              </div>
              <div style={S.sec}>
                <div style={S.secT}>Forces Applied ({forces.length})</div>
                <div style={S.list}>
                  {forces.length === 0
                    ? <span style={{ color: '#4a5568' }}>No forces yet</span>
                    : forces.map((f, i) => (
                      <div key={i}>
                        Node {f.node_id}: Fx={f.fx / 1000}kN, Fy={f.fy / 1000}kN
                      </div>
                    ))
                  }
                </div>
                {forces.length > 0 && (
                  <button style={{ ...S.btn, ...S.red, ...S.full, fontSize: 11 }}
                    onClick={() => setForces(p => p.slice(0, -1))}>↩ Remove Last Force</button>
                )}
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={S.secT}>Add Support at Node</div>
                <div style={S.hint}>
                  Pin = fixed in both X and Y.<br />
                  Roller = fixed in one direction only.<br />
                  Minimum: 1 pin + 1 roller.
                </div>
                <label style={S.label}>Node ID</label>
                <input style={S.inp} type="number" placeholder="e.g. 0" value={sNode} onChange={e => setSNode(e.target.value)} />
                <label style={S.label}>Support Type</label>
                <select style={S.inp} value={sType} onChange={e => setSType(e.target.value)}>
                  <option value="pin">📌 Pin — fixed X and Y</option>
                  <option value="roller_y">🔵 Roller — fixed Y, free X</option>
                  <option value="roller_x">🔵 Roller — fixed X, free Y</option>
                </select>
                <button style={{ ...S.btn, ...S.blue, ...S.full }} onClick={handleAddSupport}>+ Add Support</button>
                <div style={S.list}>
                  {supports.length === 0
                    ? <span style={{ color: '#4a5568' }}>No supports yet</span>
                    : supports.map((s, i) => <div key={i}>Node {s.node_id}: {s.type.toUpperCase()}</div>)
                  }
                </div>
              </div>
            </>
          )}

          {/* ── MATERIAL TAB ── */}
          {activeTab === 'material' && (
            <>
              <div style={S.sec}>
                <div style={S.secT}>Material Properties</div>
                <label style={S.label}>Young's Modulus E (GPa)</label>
                <input style={S.inp} type="number" value={matE} onChange={e => setMatE(e.target.value)} />
                <div style={S.hint}>Steel = 200 GPa · Aluminium = 70 GPa · Concrete = 30 GPa</div>
                <label style={S.label}>Cross-section Area A (m²)</label>
                <input style={S.inp} type="number" value={matA} onChange={e => setMatA(e.target.value)} step="0.001" />
                <div style={S.hint}>Default = 0.01 m² (100 cm²) — typical steel member</div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={S.secT}>Save / Load Project</div>
                <button style={{ ...S.btn, ...S.purple, ...S.full }} onClick={saveProject}>💾 Save Project</button>
                <button style={{ ...S.btn, ...S.gray, ...S.full }} onClick={loadProject}>📂 Load Project</button>
              </div>
            </>
          )}
        </div>

        {/* Bottom buttons */}
        <div style={S.foot}>
          <button style={S.solve} onClick={handleSolve} disabled={loading}>
            {loading ? '⏳ Solving...' : '⚡ SOLVE TRUSS'}
          </button>
          <div style={S.row}>
            <button style={{ ...S.btn, ...S.purple, flex: 1 }} onClick={downloadPDF}>📄 PDF</button>
            <button style={{ ...S.btn, ...S.red, flex: 1 }} onClick={handleClear}>🗑️ Clear All</button>
          </div>
        </div>
      </div>

      {/* ══════ MAIN CANVAS + RESULTS ══════ */}
      <div style={S.main}>

        {/* Canvas card */}
        <div style={S.card}>
          <div style={S.cardHead}>
            <span style={S.cardT}>
              {results
                ? '✅ Solved — Red = Tension  |  Blue = Compression'
                : '📐 Truss Diagram (auto-scaled to fit)'}
            </span>
            <span style={{ fontSize: 11, color: '#a0aec0' }}>
              {nodes.length} nodes · {members.length} members · {forces.length} loads · {supports.length} supports
            </span>
          </div>
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ border: '1px solid #e2e8f0', borderRadius: 8, display: 'block', maxWidth: '100%', backgroundColor: '#fafafa' }}
          />
          <div style={S.legend}>
            <span><span style={{ color: '#e53e3e', fontWeight: 700 }}>━━</span> Tension (pulled)</span>
            <span><span style={{ color: '#3182ce', fontWeight: 700 }}>━━</span> Compression (squeezed)</span>
            <span><span style={{ color: '#b0bec5', fontWeight: 700 }}>╌╌</span> Original</span>
            <span style={{ color: '#2b6cb0' }}>△ Pin Support</span>
            <span style={{ color: '#2b6cb0' }}>△○○ Roller Support</span>
            <span style={{ color: '#276749' }}>→ Applied Force</span>
          </div>
        </div>

        {/* Error */}
        {error && <div style={S.errBox}>❌ {error}</div>}

        {/* Results */}
        {results && results.success && (
          <div style={S.card}>
            <div style={S.cardHead}>
              <span style={S.cardT}>📊 Analysis Results</span>
              <button style={{ ...S.btn, ...S.purple }} onClick={downloadPDF}>📄 Download PDF</button>
            </div>

            {/* Summary cards */}
            <div style={S.summRow}>
              {[
                { label: 'Total Members', val: members.length, bg: '#ebf8ff', col: '#2b6cb0' },
                { label: 'In Tension',    val: Object.values(results.member_forces).filter(m => m.type === 'TENSION').length,      bg: '#fff5f5', col: '#c53030' },
                { label: 'Compression',   val: Object.values(results.member_forces).filter(m => m.type === 'COMPRESSION').length,  bg: '#ebf8ff', col: '#2b6cb0' },
                { label: 'Max Force(kN)', val: Math.max(...Object.values(results.member_forces).map(m => Math.abs(m.force / 1000))).toFixed(1), bg: '#f0fff4', col: '#276749' },
              ].map((c, i) => (
                <div key={i} style={{ ...S.sumCard, backgroundColor: c.bg }}>
                  <div style={{ fontSize: 11, color: '#718096' }}>{c.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: c.col }}>{c.val}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead>
                  <tr>
                    {['Member', 'Nodes', 'Force (kN)', 'Type', 'Stress (MPa)', 'Strain'].map(h => (
                      <th key={h} style={S.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(results.member_forces).map(([id, data]) => {
                    const isTen = data.type === 'TENSION';
                    const mem = members.find(m => m.id === id);
                    return (
                      <tr key={id} style={{ backgroundColor: isTen ? '#fff5f5' : '#ebf8ff' }}>
                        <td style={{ ...S.td, fontWeight: 700 }}>{id}</td>
                        <td style={S.td}>{mem ? `${mem.node1} → ${mem.node2}` : '-'}</td>
                        <td style={{ ...S.td, fontWeight: 700, color: isTen ? '#c53030' : '#2b6cb0' }}>
                          {(data.force / 1000).toFixed(3)}
                        </td>
                        <td style={S.td}>
                          <span style={{
                            ...S.tag,
                            backgroundColor: isTen ? '#fed7d7' : '#bee3f8',
                            color: isTen ? '#c53030' : '#2b6cb0'
                          }}>{data.type}</span>
                        </td>
                        <td style={S.td}>{(data.stress / 1e6).toFixed(3)}</td>
                        <td style={S.td}>{data.strain ? data.strain.toExponential(3) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrussDrawer;