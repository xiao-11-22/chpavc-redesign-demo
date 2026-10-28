/**
 * 立体地球 · 全球布局
 * ---------------------------------------------------------------
 * 依赖：three.js (r169, ESM via CDN) + world-atlas 陆地轮廓数据
 * 数据来源：设计稿 P18「产业分布」—— 海外 6 国 + 国内 10 省市
 *
 * 特性：
 *  - 真实经纬度投影（等距圆柱 -> 球面），点位落在真实位置
 *  - 陆地轮廓线 + 国界描边，随球体自转
 *  - 点位脉冲光环 + 名称标签（HTML 叠加层，始终朝向读者）
 *  - 大连总部到各海外点位的飞线弧（贝塞尔曲线）
 *  - 鼠标拖拽旋转 / 滚轮缩放 / 悬停高亮
 *  - 页面不可见时暂停渲染；尊重 prefers-reduced-motion
 */
import * as THREE from './vendor/three.module.js';
import { feature } from './vendor/topojson/index.js';

// 数据路径必须基于模块自身 URL 解析，
// 否则 fetch('../data/...') 会以「文档 URL」为基准，
// 部署到子目录（如 GitHub Pages 的 /repo/）时会解析到站点根目录而 404。
const LAND_DATA = new URL('../data/land-110m.json', import.meta.url).href;

/* ---------- 点位数据（经度, 纬度, 中文名, 类型） ---------- */
const SITES = [
  // 总部
  { lon: 121.6147, lat: 38.9140, name: '大连', full: '中国·大连 总部', type: 'hq' },
  // 国内 10 省市（设计稿 P18）
  { lon: 123.4315, lat: 41.8057, name: '辽宁', type: 'cn' },
  { lon: 125.3245, lat: 43.8868, name: '吉林', type: 'cn' },
  { lon: 126.6424, lat: 45.7560, name: '黑龙江', type: 'cn' },
  { lon: 117.1901, lat: 39.1252, name: '天津', type: 'cn' },
  { lon: 117.1205, lat: 36.6512, name: '山东', type: 'cn' },
  { lon: 120.1536, lat: 30.2875, name: '浙江', type: 'cn' },
  { lon: 118.7674, lat: 32.0415, name: '江苏', type: 'cn' },
  { lon: 119.3062, lat: 26.0753, name: '福建', type: 'cn' },
  { lon: 113.2644, lat: 23.1291, name: '广东', type: 'cn' },
  { lon: 121.4737, lat: 31.2304, name: '上海', type: 'cn' },
  // 海外 6 国（设计稿 P18 编号 ①~⑥）
  { lon: 139.6917, lat: 35.6895, name: '日本', no: '①', type: 'os' },
  { lon: 103.8198, lat: 1.3521, name: '新加坡', no: '②', type: 'os' },
  { lon: 101.9758, lat: 4.2105, name: '马来西亚', no: '④', type: 'os' },
  { lon: 15.4728, lat: 49.8175, name: '捷克', no: '⑤', type: 'os' },
  { lon: -95.7129, lat: 37.0902, name: '美国', no: '⑥', type: 'os' },
  { lon: -51.9253, lat: -14.2350, name: '巴西', no: '③', type: 'os' }
];

const COLOR = {
  ocean:    0x0a1c33,
  land:     0x1d4a6b,
  landEdge: 0x2f7fb5,
  grid:     0x16405e,
  hq:       0x00e5ff,
  cn:       0x38bdf8,
  os:       0x7dd3fc,
  arc:      0x00b0f0
};

export async function mountGlobe(container, opts = {}) {
  let {
    width = container.clientWidth,
    height = container.clientHeight,
    autoRotate = true,
    showArcs = true,
    labels = true
  } = opts;

  /* ---------- 渲染器 ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  camera.position.z = 3.6;

  const world = new THREE.Group();      // 自转组
  scene.add(world);

  /* ---------- 球体 ---------- */
  const R = 1;
  const globe = new THREE.Group();
  world.add(globe);

  // 海洋球
  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(R, 64, 48),
    new THREE.MeshPhongMaterial({
      color: COLOR.ocean,
      emissive: 0x061420,
      shininess: 28,
      specular: 0x0e5c8a,
      transparent: true,
      opacity: 0.97
    })
  );
  globe.add(ocean);

  // 大气光晕（背面渲染的加色球）—— 收紧到边缘，避免整体泛白盖住陆地
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.10, 48, 36),
    new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vN;
        void main(){
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }`,
      fragmentShader: `
        varying vec3 vN;
        void main(){
          float i = pow(0.95 - dot(vN, vec3(0.0,0.0,1.0)), 4.5);
          gl_FragColor = vec4(0.0, 0.69, 0.94, i * 0.5);
        }`,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    })
  );
  world.add(atmo);

  /* ---------- 经纬网格 ---------- */
  const gridPts = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let i = 0; i <= 120; i++) {
      const lon = -180 + (360 * i) / 120;
      gridPts.push(latLonToVec3(lon, lat, R * 1.002));
    }
  }
  for (let lon = -180; lon < 180; lon += 30) {
    for (let i = 0; i <= 60; i++) {
      const lat = -90 + (180 * i) / 60;
      gridPts.push(latLonToVec3(lon, lat, R * 1.002));
    }
  }
  const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPts);
  globe.add(new THREE.LineSegments(
    gridGeo,
    new THREE.LineBasicMaterial({ color: COLOR.grid, transparent: true, opacity: 0.45 })
  ));

  /* ---------- 陆地（填充面 + 轮廓线） ---------- */
  try {
    const topo = await fetch(LAND_DATA).then(r => r.json());
    const landObj = feature(topo, topo.objects.land);

    // feature() 对 GeometryCollection 返回 FeatureCollection，需展平所有 geometry
    const geoms = [];
    const collectGeom = (g) => {
      if (!g) return;
      if (g.type === 'GeometryCollection') g.geometries.forEach(collectGeom);
      else geoms.push(g);
    };
    if (landObj.type === 'FeatureCollection') {
      landObj.features.forEach(f => collectGeom(f.geometry));
    } else {
      collectGeom(landObj.geometry);
    }

    // 轮廓线
    const linePts = [];
    const pushRing = (ring) => {
      for (let i = 0; i < ring.length; i++) {
        const [lon, lat] = ring[i];
        linePts.push(latLonToVec3(lon, lat, R * 1.008));
      }
    };
    geoms.forEach(g => {
      if (g.type === 'MultiPolygon') g.coordinates.forEach(poly => poly.forEach(pushRing));
      else if (g.type === 'Polygon') g.coordinates.forEach(pushRing);
    });
    if (linePts.length) {
      globe.add(new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(linePts),
        new THREE.LineBasicMaterial({ color: COLOR.landEdge, transparent: true, opacity: 0.95 })
      ));
    }

    // 填充面：在经纬度平面三角化，再映射到球面
    const shapes = [];
    geoms.forEach(g => {
      const polys = g.type === 'MultiPolygon' ? g.coordinates
        : g.type === 'Polygon' ? [g.coordinates] : [];
      polys.forEach(poly => {
        const ring = poly[0];
        if (!ring || ring.length < 3) return;
        const shape = new THREE.Shape();
        ring.forEach(([lon, lat], i) => {
          const x = lon * Math.PI / 180;
          const y = lat * Math.PI / 180;
          if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
        });
        shape.closePath();
        shapes.push(shape);
      });
    });

    if (shapes.length) {
      const landGeo = new THREE.ShapeGeometry(shapes, 8);
      const pos = landGeo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        const lon = pos.getX(i) * 180 / Math.PI;
        const lat = pos.getY(i) * 180 / Math.PI;
        v.copy(latLonToVec3(lon, lat, R * 1.003));
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      landGeo.computeVertexNormals();
      globe.add(new THREE.Mesh(
        landGeo,
        new THREE.MeshBasicMaterial({
          color: COLOR.land, transparent: true, opacity: 0.9,
          side: THREE.DoubleSide, depthWrite: false
        })
      ));
    }
  } catch (e) {
    console.warn('[globe] 陆地数据加载失败，仅显示网格球体', e);
  }

  /* ---------- 点位 ---------- */
  const markers = [];
  const labelLayer = document.createElement('div');
  labelLayer.className = 'globe-labels';
  container.appendChild(labelLayer);

  SITES.forEach(site => {
    const color = site.type === 'hq' ? COLOR.hq : site.type === 'os' ? COLOR.os : COLOR.cn;
    const group = new THREE.Group();
    group.position.copy(latLonToVec3(site.lon, site.lat, R * 1.001));

    // 核心点
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(site.type === 'hq' ? 0.028 : 0.019, 16, 12),
      new THREE.MeshBasicMaterial({ color })
    );
    group.add(dot);

    // 脉冲光环
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.028, 0.038, 32),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    ring.lookAt(0, 0, 0);
    group.add(ring);

    // 引线 + 标签（HTML 层）
    let el = null;
    if (labels) {
      el = document.createElement('div');
      el.className = 'globe-label' + (site.type === 'hq' ? ' hq' : '') + (site.type === 'os' ? ' os' : '');
      el.innerHTML = `<b>${site.no || ''}</b><span>${site.name}</span>`;
      el.title = site.full || site.name;
      labelLayer.appendChild(el);
    }

    markers.push({ site, group, ring, dot, el, color, base: group.position.clone() });
    globe.add(group);
  });

  /* ---------- 飞线弧（大连 -> 海外点位） ---------- */
  const arcs = [];
  if (showArcs) {
    const hq = SITES.find(s => s.type === 'hq');
    const from = latLonToVec3(hq.lon, hq.lat, R * 1.01);
    SITES.filter(s => s.type === 'os').forEach(site => {
      const to = latLonToVec3(site.lon, site.lat, R * 1.01);
      const mid = from.clone().add(to).multiplyScalar(0.5).normalize()
        .multiplyScalar(R * (1 + 0.22 + 0.10 * (1 - from.angleTo(to) / Math.PI)));
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: COLOR.arc, transparent: true, opacity: 0.55
      }));
      globe.add(line);
      arcs.push({ site, line, curve, geo });
    });
  }

  /* ---------- 光照 ---------- */
  scene.add(new THREE.AmbientLight(0x4a7fa8, 0.85));
  const key = new THREE.DirectionalLight(0xbfe8ff, 1.5);
  key.position.set(5, 3, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x00b0f0, 0.9);
  rim.position.set(-5, -2, -4);
  scene.add(rim);

  /* ---------- 交互：拖拽旋转 / 滚轮缩放 ---------- */
  let dragging = false, prevX = 0, prevY = 0;
  // 初始视角对准东亚：大连 / 日本 / 新加坡 / 马来西亚 同时在正面
  let rotY = -3.2, rotX = 0.34, userControlled = false;
  const el = renderer.domElement;
  el.style.cursor = 'grab';
  el.style.touchAction = 'none';

  el.addEventListener('pointerdown', e => {
    dragging = true; userControlled = true;
    prevX = e.clientX; prevY = e.clientY;
    el.style.cursor = 'grabbing';
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    rotY += (e.clientX - prevX) * 0.005;
    rotX = Math.max(-1.35, Math.min(1.35, rotX + (e.clientY - prevY) * 0.004));
    prevX = e.clientX; prevY = e.clientY;
  });
  const endDrag = e => {
    dragging = false; el.style.cursor = 'grab';
    if (e && e.pointerId != null && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('wheel', e => {
    e.preventDefault();
    camera.position.z = Math.max(2.4, Math.min(5.4, camera.position.z + e.deltaY * 0.0018));
  }, { passive: false });

  /* ---------- 悬停点位 ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null;
  el.addEventListener('pointermove', e => {
    if (dragging) return;
    const rect = el.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(markers.map(m => m.dot), false);
    const hit = hits.length ? markers.find(m => m.dot === hits[0].object) : null;
    if (hit !== hovered) {
      hovered = hit;
      markers.forEach(m => {
        const on = m === hit;
        m.dot.scale.setScalar(on ? 1.7 : 1);
        m.el?.classList.toggle('hover', on);
        m.ring.material.opacity = on ? 1 : 0.75;
      });
      el.style.cursor = hit ? 'pointer' : 'grab';
    }
  });

  /* ---------- 渲染循环 ---------- */
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = null, running = false, last = performance.now(), t0 = 0;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t0 += dt;

    // 自转
    if (autoRotate && !reduce && !userControlled && !dragging) {
      rotY += dt * 0.075;
    }
    world.rotation.y = rotY;
    world.rotation.x = rotX;

    // 点位脉冲
    markers.forEach((m, i) => {
      const phase = (t0 * 0.9 + i * 0.34) % 1;
      const s = 1 + phase * 1.9;
      m.ring.scale.setScalar(s);
      m.ring.material.opacity = 0.72 * (1 - phase);
    });

    // 飞线流光
    if (arcs.length) {
      arcs.forEach((a, i) => {
        const phase = (t0 * 0.42 + i * 0.19) % 1;
        a.line.material.opacity = 0.28 + 0.46 * Math.sin(phase * Math.PI);
      });
    }

    // 标签投影 + 避让（同一区域标签自动错开）
    if (labels) {
      const v = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const sphereCenter = new THREE.Vector3();
      globe.getWorldPosition(sphereCenter);

      // 先算出所有可见标签的屏幕坐标
      const placed = [];
      markers.forEach(m => {
        if (!m.el) return;
        v.copy(m.group.position);
        world.localToWorld(v);
        const outward = v.clone().sub(sphereCenter).normalize();
        const toCam = camera.position.clone().sub(v).normalize();
        const front = outward.dot(toCam);
        if (front < 0.04) {
          m.el.style.opacity = '0';
          m.el.style.pointerEvents = 'none';
          m._hide = true;
          return;
        }
        m._hide = false;
        const proj = v.clone().project(camera);
        placed.push({
          m,
          x: (proj.x * 0.5 + 0.5) * width,
          y: (-proj.y * 0.5 + 0.5) * height,
          front,
          // 重要点位（总部/海外）优先占位，国内省市让位
          prio: m.site.type === 'hq' ? 0 : m.site.type === 'os' ? 1 : 2
        });
      });

      // 按优先级排序后依次避让
      placed.sort((a, b) => a.prio - b.prio);
      const occupied = [];
      placed.forEach(p => {
        let ty = p.y;
        let attempt = 0;
        const W = 78, H = 22;
        while (attempt < 24) {
          const clash = occupied.some(o =>
            Math.abs(o.x - p.x) < W && Math.abs(o.y - ty) < H
          );
          if (!clash) break;
          ty += 24;
          attempt++;
        }
        // 超出容器则反向避让
        if (ty > height - 20) {
          ty = p.y;
          for (let k = 0; k < 24; k++) {
            const clash = occupied.some(o =>
              Math.abs(o.x - p.x) < W && Math.abs(o.y - ty) < H
            );
            if (!clash) break;
            ty -= 24;
          }
        }
        occupied.push({ x: p.x, y: ty });
        const m = p.m;
        m.el.style.opacity = String(Math.min(1, (p.front - 0.04) * 4));
        m.el.style.transform = `translate(-50%,-50%) translate(${p.x.toFixed(1)}px,${ty.toFixed(1)}px)`;
      });
    }

    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true; last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  // 不可见时暂停
  const io = new IntersectionObserver(es => {
    es[0].isIntersecting ? start() : stop();
  }, { threshold: 0.05 });
  io.observe(container);

  document.addEventListener('visibilitychange', () => {
    document.hidden ? stop() : start();
  });

  // 尺寸自适应
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    width = w; height = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ro.observe(container);

  start();

  return { start, stop, scene, renderer, camera, markers };
}

/* ---------- 经纬度 -> 球面坐标 ---------- */
function latLonToVec3(lon, lat, r) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}
