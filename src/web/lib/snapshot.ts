/** Snapshot export — render the current graph as a PNG (canvas capture) or SVG (2D projection). */

export interface ProjectedNode {
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  /** NDC depth, used for painter's-order sorting */
  depth: number;
}

export interface ProjectedLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  arrow: boolean;
}

export interface SvgSnapshotOptions {
  width: number;
  height: number;
  nodes: ProjectedNode[];
  links: ProjectedLink[];
  subtitle: string;
  legend?: { label: string; color: string }[];
}

const BACKGROUND = '#04040e';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Build a standalone SVG document of the projected graph (pure — testable) */
export function buildGraphSVG(opts: SvgSnapshotOptions): string {
  const { width, height, links, subtitle, legend = [] } = opts;
  // Painter's order: far nodes first so near nodes draw on top
  const nodes = [...opts.nodes].sort((a, b) => b.depth - a.depth);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Fira Code', ui-monospace, monospace">`,
  );
  parts.push(`<rect width="${width}" height="${height}" fill="${BACKGROUND}"/>`);
  parts.push(
    `<defs><marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,138,43,0.6)"/></marker></defs>`,
  );

  for (const link of links) {
    const marker = link.arrow ? ' marker-end="url(#dep-arrow)"' : '';
    parts.push(
      `<line x1="${round(link.x1)}" y1="${round(link.y1)}" x2="${round(link.x2)}" y2="${round(link.y2)}" stroke="${link.color}" stroke-width="${link.width}"${marker}/>`,
    );
  }

  for (const node of nodes) {
    const x = round(node.x);
    const y = round(node.y);
    const r = round(node.r);
    parts.push(
      `<circle cx="${x}" cy="${y}" r="${round(r * 1.8)}" fill="${node.color}" opacity="0.12"/>`,
    );
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${node.color}" opacity="0.92"/>`);
    const fontSize = Math.max(8, Math.min(12, r * 1.3));
    parts.push(
      `<text x="${x}" y="${round(y + r + fontSize + 3)}" text-anchor="middle" font-size="${round(fontSize)}" fill="#b8c4d4" opacity="0.85">${escapeXml(node.label)}</text>`,
    );
  }

  // Header: brand + timestamp
  parts.push(
    `<text x="20" y="30" font-size="14" font-weight="600" fill="#00e4ff">DockScope</text>`,
  );
  parts.push(`<text x="20" y="46" font-size="10" fill="#7a8599">${escapeXml(subtitle)}</text>`);

  // Legend (statuses present in the snapshot)
  let ly = height - 16 - (legend.length - 1) * 16;
  for (const entry of legend) {
    parts.push(`<circle cx="24" cy="${ly - 3}" r="4" fill="${entry.color}"/>`);
    parts.push(
      `<text x="34" y="${ly}" font-size="10" fill="#b8c4d4">${escapeXml(entry.label)}</text>`,
    );
    ly += 16;
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function snapshotFilename(ext: 'png' | 'svg', now = new Date()): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `dockscope-${stamp}.${ext}`;
}

/** Copy the WebGL canvas onto an opaque 2D canvas and add a small caption footer */
export function captureCanvasPNG(source: HTMLCanvasElement, caption: string): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.resolve(null);
  }
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);

  // Caption scales with the drawing buffer (which includes devicePixelRatio)
  const scale = Math.max(1, canvas.width / 1280);
  const fontSize = Math.round(11 * scale);
  ctx.font = `600 ${fontSize}px "Fira Code", ui-monospace, monospace`;
  ctx.fillStyle = 'rgba(122, 133, 153, 0.9)';
  ctx.fillText(caption, Math.round(14 * scale), canvas.height - Math.round(14 * scale));

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
