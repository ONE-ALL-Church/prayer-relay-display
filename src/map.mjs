const mirror = 'https://storage.googleapis.com/location-grid-mirror-v2/tiles/world/flat_states';

export async function loadMap(demo, fetcher = fetch) {
  async function json(url) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Map unavailable.');
    return response.json();
  }
  if (demo) return json('/demo-map.json');
  const files = await Promise.all(Array.from({ length: 10 }, (_, i) => json(`${mirror}/${i + 1}.geojson`)));
  return files.flatMap(file => file.features.map(feature => ({
    id: String(feature.properties.grid_id),
    shape: feature.geometry,
  })));
}

export function project(lon, lat) {
  return [500 + lon * 2.77, 234 - lat * 2.77];
}

export function mapPath(shape) {
  const polygons = shape.type === 'MultiPolygon' ? shape.coordinates : [shape.coordinates];
  return polygons.map(polygon => polygon.map(ring => {
    let previous;
    const path = ring.map(([lon, lat], index) => {
      if (previous !== undefined) lon += Math.round((previous - lon) / 360) * 360;
      previous = lon;
      return (index ? 'L' : 'M') + project(lon, lat).map(n => n.toFixed(1)).join(' ');
    }).join('') + 'Z';
    return path;
  }).join('')).join('');
}

export function drawMap(svg, features) {
  const fragment = document.createDocumentFragment();
  const paths = new Map();
  for (const feature of features) {
    if (!['Polygon', 'MultiPolygon'].includes(feature.shape?.type)) continue;
    const d = mapPath(feature.shape);
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'map-region');
    const elements = [path];
    // Draw both sides of an area that crosses the edge of the projection.
    if (/M-\d|L-\d|[ML](?:100\d|10[1-9]\d|1[1-9]\d\d)\./.test(d)) {
      for (const x of [-997.2, 997.2]) {
        const copy = path.cloneNode();
        copy.setAttribute('transform', `translate(${x} 0)`);
        elements.push(copy);
      }
    }
    fragment.append(...elements);
    paths.set(feature.id, [...(paths.get(feature.id) ?? []), ...elements]);
  }
  svg.replaceChildren(fragment);
  return paths;
}
