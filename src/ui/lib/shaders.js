// WebGL backdrops of the themes with a shader (Orb UI 2.0). The fragment shaders are the approved ones from the design,
// untouched; the code around them is what the app adds: half resolution, 30 fps at most, nothing running while the window
// is hidden, one still frame under reduced motion, and no failure at all when WebGL is missing or the context is lost.
const HEAD = 'precision mediump float;uniform vec2 R;uniform float T;uniform float D;' +
  'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}' +
  'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}' +
  'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}';

const FRAG = {
  // Cristal: a pale liquid wallpaper with a hint of blue, pink, peach, violet and aqua that flows very slowly.
  cristal: HEAD + `void main(){vec2 uv=gl_FragCoord.xy/R;vec2 p=uv*vec2(R.x/R.y,1.);float t=T*.035;
    vec2 w=vec2(fbm(p*1.1+vec2(t,-t)),fbm(p*1.1+vec2(-t,t)+5.2));
    float f=fbm(p*1.0+w*1.7+t);
    vec3 col=mix(vec3(.36,.56,1.),vec3(1.,.52,.74),smoothstep(.28,.72,f));
    col=mix(col,vec3(1.,.76,.5),smoothstep(.55,.85,w.x)*.8);
    col=mix(col,vec3(.63,.47,1.),smoothstep(.5,.8,w.y)*.7);
    col=mix(col,vec3(.45,.88,.95),smoothstep(.6,.9,fbm(p*.8-t*1.3+3.))*.6);
    for(int i=0;i<3;i++){float fi=float(i);vec2 c=vec2(.3+fi*.55+.15*sin(T*.07+fi*2.),.5+.3*cos(T*.05+fi*1.7));col+=.2*exp(-6.*dot(p-c,p-c));}
    // only a hint of colour: most of it washed out to a pale, almost white wallpaper
    float l=dot(col,vec3(.299,.587,.114));col=mix(vec3(l),col,.42);
    gl_FragColor=vec4(mix(col,vec3(.975,.978,.99),.5),1.);}`,
  // Orb: a calm sky. Day: soft blue with drifting clouds. Night: deep blue, stars that twinkle, a faint aurora.
  orb: HEAD + `void main(){vec2 uv=gl_FragCoord.xy/R;vec2 p=uv*vec2(R.x/R.y,1.);
    vec3 day=mix(vec3(.80,.89,1.),vec3(.55,.72,.98),uv.y);
    float c=smoothstep(.45,.8,fbm(p*2.2+vec2(T*.015,0.)));day=mix(day,vec3(1.),c*.75);
    vec3 night=mix(vec3(.05,.07,.18),vec3(.12,.1,.3),uv.y);
    float s=step(.997,h(floor(p*220.)))*(.5+.5*sin(T*2.+h(floor(p*220.))*40.));night+=s;
    night+=vec3(.1,.35,.4)*smoothstep(.3,.9,fbm(vec2(p.x*1.5+T*.02,p.y*3.)))*smoothstep(.4,1.,uv.y)*.5;
    gl_FragColor=vec4(mix(day,night,D),1.);}`,
  // Vaporwave: a striped sun over a moving neon grid. Day: pastel pink and teal. Night: synthwave purple.
  vaporwave: HEAD + `void main(){vec2 uv=gl_FragCoord.xy/R;float a=R.x/R.y;vec2 p=vec2((uv.x-.5)*a,uv.y-.42);
    vec3 skyD=mix(vec3(1.,.8,.9),vec3(.62,.86,.95),uv.y);vec3 skyN=mix(vec3(.55,.12,.45),vec3(.06,.02,.16),uv.y*1.2);
    vec3 col=mix(skyD,skyN,D);
    float r=length(p-vec2(0.,.12));float sun=smoothstep(.27,.265,r);
    float band=step(.5,fract((p.y-.12)*22.+T*.25));sun*=p.y>.06?1.:band;
    vec3 sunc=mix(mix(vec3(1.,.55,.7),vec3(1.,.95,.5),uv.y),mix(vec3(1.,.2,.6),vec3(1.,.85,.3),(p.y+.15)*2.),D);
    col=mix(col,sunc,sun*step(0.,p.y));
    if(p.y<0.){float z=.35/(-p.y+.02);vec2 g=vec2(p.x*z,z+T*.9);
      vec2 l=abs(fract(g)-.5)/fwidth(g);float line=1.-min(min(l.x,l.y),1.);
      vec3 floorc=mix(vec3(.98,.86,.95),vec3(.08,.0,.15),D);
      vec3 lc=mix(vec3(.4,.75,.9),vec3(1.,.25,.8),D);
      col=mix(floorc,lc,line*smoothstep(0.,.3,-p.y+.02));}
    gl_FragColor=vec4(col,1.);}`,
  // Candy: a sky of sweets that float up slowly: lollipops, wrapped sweets, gummy bears and jelly beans,
  // each with its own colour, a soft shadow and a sugar shine. Drawn with shapes (distance fields), no images.
  candy: HEAD + `
    float sdBox(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,d.y),0.);}
    float sdCap(vec2 p,vec2 a,vec2 b,float r){vec2 pa=p-a,ba=b-a;float k=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*k)-r;}
    float sdEll(vec2 p,vec2 ab){return (length(p/ab)-1.)*min(ab.x,ab.y);}
    // the sweet itself (stick and bows apart): 0 lollipop, 1 wrapped sweet, 2 gummy bear, 3 jelly bean
    float body(vec2 q,float t,float r){
      if(t<.5)return length(q)-r;
      if(t<1.5)return sdEll(q,vec2(.62*r,.5*r));
      if(t<2.5){float d=length(q-vec2(0.,.5*r))-.34*r;
        d=min(d,length(vec2(abs(q.x),q.y)-vec2(.27*r,.8*r))-.13*r);
        d=min(d,sdEll(q-vec2(0.,-.2*r),vec2(.4*r,.48*r)));
        d=min(d,length(vec2(abs(q.x),q.y)-vec2(.4*r,.08*r))-.14*r);
        d=min(d,length(vec2(abs(q.x),q.y)-vec2(.26*r,-.66*r))-.17*r);return d;}
      return sdCap(q,vec2(-.48*r,-.06*r),vec2(.48*r,.06*r),.34*r);}
    float extra(vec2 q,float t,float r){
      if(t<.5)return sdBox(q-vec2(0.,-1.55*r),vec2(.07*r,.6*r));
      if(t<1.5){vec2 a=vec2(abs(q.x),q.y);return max(abs(a.y)-.12*r-(a.x-.55*r)*.85,abs(a.x-1.02*r)-.42*r);}
      return 1.;}
    void main(){
      vec2 uv=gl_FragCoord.xy/R;vec2 p=gl_FragCoord.xy/R.y;float aa=2./R.y;
      vec3 col=mix(mix(vec3(1.,.9,.95),vec3(.88,.96,1.),uv.y),mix(vec3(.2,.09,.19),vec3(.11,.07,.2),uv.y),D);
      float S=.3;float cx=floor(p.x/S);float sp=.025+.02*h(vec2(cx,7.));
      vec2 g=vec2(p.x,p.y-T*sp);vec2 cell=vec2(cx,floor(g.y/S));
      float e=h(cell);
      if(e>.22){
        float t=floor(h(cell+3.1)*4.);float r=S*(t<.5?.14:t<1.5?.17:.2);
        vec2 q=(fract(g/S)-.5)*S-(vec2(h(cell+1.3),h(cell+2.7))-.5)*S*.1;
        float an=h(cell+5.)*6.2831+.35*sin(T*.6+e*20.);q=mat2(cos(an),-sin(an),sin(an),cos(an))*q;
        vec3 c=.6+.4*cos(6.2831*(h(cell+9.)+vec3(0.,.33,.67)));c=mix(c,vec3(1.),.12);
        if(D>.5)c*=.85;
        // soft shadow below and to the right
        vec2 so=vec2(.012,-.018)*S/.3;float ds=min(body(q-so,t,r),extra(q-so,t,r));
        col=mix(col,col*.78,(1.-smoothstep(-aa*4.,aa*6.,ds))*.5);
        // lollipop stick and wrapper bows first
        float dx=extra(q,t,r);
        vec3 xc=t<.5?mix(vec3(.98,.96,.92),vec3(.85,.82,.78),smoothstep(-.07*r,.07*r,q.x)):c*.82;
        if(t>.5&&t<1.5)xc=mix(xc,c*.7,step(.5,fract(abs(q.y)/r*3.)));
        col=mix(col,xc,1.-smoothstep(-aa,aa,dx));
        // the body, with the look of each sweet
        float db=body(q,t,r);vec3 bc=c;
        if(t<.5){float a2=atan(q.y,q.x)/6.2831;bc=mix(c,vec3(1.),step(.5,fract(length(q)/r*2.2+a2*2.)))*mix(1.,.92,step(.5,fract(length(q)/r*2.2+a2*2.)));}
        else if(t<1.5){bc=mix(c,mix(c,vec3(1.),.65),step(.62,fract((q.x+q.y)/r*2.4)));}
        else if(t<2.5){bc=mix(c*.8,c*1.08,smoothstep(.1*r,-.3*r,db));}
        else{bc=mix(c*.86,c*1.05,smoothstep(.1*r,-.25*r,db));}
        float ba=1.-smoothstep(-aa,aa,db);
        col=mix(col,bc,ba*(t>1.5&&t<2.5?.9:1.));
        // sugar shine: a small bright spot up and to the left
        float sh=sdEll(q-vec2(-.25*r,.25*r),vec2(.16*r,.09*r));
        if(t>2.5)sh=sdEll(q-vec2(-.15*r,.16*r),vec2(.26*r,.07*r));
        if(t>1.5&&t<2.5)sh=length(q-vec2(-.12*r,.62*r))-.07*r;
        col=mix(col,vec3(1.),(1.-smoothstep(-aa,aa*2.,sh))*ba*.7);
      }
      gl_FragColor=vec4(col,1.);}`,
  // Retro: green phosphor with a slow rolling bar and a little flicker (the scanlines are the .crt glass).
  retro: HEAD + `void main(){vec2 uv=gl_FragCoord.xy/R;
    float roll=smoothstep(.0,.08,abs(fract(uv.y-T*.05)-.5));
    float g=.035+.02*n(uv*vec2(300.,500.)+T*30.)+.015*(1.-roll);
    g*=1.-.6*length(uv-.5);
    gl_FragColor=vec4(vec3(.15,1.,.35)*g*(1.+.04*sin(T*60.)),1.);}`
};

export const SHADER_SKINS = Object.keys(FRAG);
export const hasShader = (skin) => Object.hasOwn(FRAG, skin);

const SCALE = 0.5; // half resolution: the backdrop is soft and the GPU cost drops to a quarter
const FRAME_MS = 33; // 30 frames a second at most
const STILL_AT = 12; // the second a still frame is drawn at (a pleasant moment of every shader)
const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

// Starts the shader of `skin` on `canvas`. Returns { stop, redraw }; without WebGL it does nothing and still returns both.
export function startShader(canvas, skin) {
  const noop = { stop() {}, redraw() {} };
  if (!hasShader(skin) || typeof document === 'undefined') return noop;
  const root = document.documentElement;
  let gl = null;
  try { gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false }); } catch { gl = null; }
  if (!gl) return noop;

  let prog = null, buf = null, shaders = [], uR = null, uT = null, uD = null;
  let raf = 0, last = 0, lost = false, alive = true, drawn = false;
  const t0 = performance.now();
  const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const still = () => Boolean(reduce?.matches) || root.dataset.motion === 'minima';

  function build() {
    gl.getExtension('OES_standard_derivatives'); // vaporwave's grid lines use fwidth()
    const src = (skin === 'vaporwave' ? '#extension GL_OES_standard_derivatives : enable\n' : '') + FRAG[skin];
    const compile = (type, text) => {
      const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); shaders.push(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, src);
    if (!vs || !fs) return false;
    prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); // one triangle covers the screen
    const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    uR = gl.getUniformLocation(prog, 'R'); uT = gl.getUniformLocation(prog, 'T'); uD = gl.getUniformLocation(prog, 'D');
    return true;
  }
  function release() {
    if (!gl || gl.isContextLost()) { prog = buf = null; shaders = []; return; }
    if (prog) gl.deleteProgram(prog);
    if (buf) gl.deleteBuffer(buf);
    for (const s of shaders) gl.deleteShader(s);
    prog = buf = null; shaders = [];
  }

  function draw(now) {
    if (lost || !prog || canvas.width < 2) return;
    gl.uniform2f(uR, canvas.width, canvas.height);
    gl.uniform1f(uT, still() ? STILL_AT : (now - t0) / 1000);
    gl.uniform1f(uD, root.classList.contains('dark') || skin === 'retro' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    drawn = true;
  }
  function frame(now) {
    raf = 0;
    // no frame requested: the loop is really off. A canvas taken out of the page has nothing to show either.
    if (!alive || lost || document.hidden || still() || !canvas.isConnected) return;
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    last = now;
    draw(now);
  }
  // One place decides what runs: a loop while moving and visible, a single frame when still, nothing when hidden or lost.
  function update() {
    if (!alive || lost) return;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (document.hidden) return;
    if (still()) { draw(performance.now()); return; }
    raf = requestAnimationFrame(frame);
  }
  // The size comes from the observer, never from layout reads in the frame; resizing clears the buffer, so draw at once.
  function size(w, h) {
    const cw = Math.max(2, (w * SCALE) | 0), ch = Math.max(2, (h * SCALE) | 0);
    if (cw === canvas.width && ch === canvas.height && drawn) return;
    canvas.width = cw; canvas.height = ch;
    if (!lost) gl.viewport(0, 0, cw, ch);
    drawn = false;
    if (!document.hidden) draw(performance.now());
  }

  const onLost = (e) => { e.preventDefault(); lost = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } prog = buf = null; shaders = []; };
  const onRestored = () => {
    lost = false; drawn = false;
    if (!build()) return; // the theme's colour stays
    gl.viewport(0, 0, canvas.width, canvas.height);
    update();
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => { const r = es[0].contentRect; size(r.width, r.height); }) : null;
  const onResize = () => size(canvas.clientWidth, canvas.clientHeight);
  // dark mode and the «animations off» setting live on <html>; changing either only needs a new frame
  const look = () => `${root.classList.contains('dark')}|${root.dataset.motion}`;
  let seen = look();
  const mo = new MutationObserver(() => { const now = look(); if (now !== seen) { seen = now; update(); } });
  const onPlay = () => update();

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  document.addEventListener('visibilitychange', onPlay);
  reduce?.addEventListener?.('change', onPlay);
  mo.observe(root, { attributes: true, attributeFilter: ['class', 'data-motion'] });
  if (ro) ro.observe(canvas); else { window.addEventListener('resize', onResize); onResize(); }
  if (!build()) { /* a shader that does not compile leaves the theme's colour */ }
  update();

  return {
    stop() {
      if (!alive) return;
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect(); mo.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onPlay);
      reduce?.removeEventListener?.('change', onPlay);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      release();
      // a canvas that is going away gives its context back; one that stays (a repeated effect) must keep it
      if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    redraw() { update(); }
  };
}
