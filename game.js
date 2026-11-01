(function(){
'use strict';
if(typeof THREE==='undefined'){
  document.body.innerHTML='<p style="padding:2em;color:#fff;font-family:sans-serif">Não foi possível carregar o Three.js (CDN). Verifique sua conexão com a internet e recarregue a página.</p>';
  return;
}

/* ============================================================
   CONFIG
   ============================================================ */
const CFG={
  duration:150,      // segundos para vencer
  startGap:48,       // distância inicial do jacaré (m)
  appearT:9,         // segundo em que o jacaré emerge
  catchDist:4,       // abaixo disso o jacaré pega a canoa
  dangerDist:24,     // abaixo disso começa o perigo
  maxGap:110,
  vMin:7, vMax:32, vTired:17,
  drain:0.09, regen:0.12, resumeAt:0.3,
  forestN:300, bushN:170, rockN:36, logN:36, obsN:9,
  rainN:4500, sprayN:240,
  fog:0x2a3835
};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const rand=(a,b)=>a+Math.random()*(b-a);
const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));
const hash1=n=>{const s=Math.sin(n*127.1+311.7)*43758.5453;return s-Math.floor(s);};
const fmt=s=>{s=Math.max(0,Math.floor(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const $=id=>document.getElementById(id);

/* Rio: linha central, largura e ondas (compartilhadas entre CPU e shader) */
const riverC=z=>16*Math.sin(z*0.012)+6*Math.sin(z*0.031+2.0);
const riverDC=z=>16*0.012*Math.cos(z*0.012)+6*0.031*Math.cos(z*0.031+2.0);
const riverDDC=z=>-16*0.012*0.012*Math.sin(z*0.012)-6*0.031*0.031*Math.sin(z*0.031+2.0);
/* Percurso: 3 fases (cheia, banzeiro, seca), medidas pela distância percorrida */
const COURSE={L:3600,
  names:['A CHEIA','O BANZEIRO','A SECA'],
  subs:['Troncos e camalotes bloqueiam o canal.','Ondas fortes — e a sucuri está caçando.','O rio encolheu: cuidado com os bancos de areia.']};
let RUN_Z0=0,worldDirty=false;
const zEnd=()=>RUN_Z0-COURSE.L;
const progressAt=z=>clamp((RUN_Z0-z)/COURSE.L,0,1);
const phaseOf=p=>p<1/3?0:p<2/3?1:2;
const dryAt=p=>smooth((p-0.62)/0.15);
const nearVillage=z=>Math.abs(z-(zEnd()-8))<34;
const riverW=z=>(60+10*Math.sin(z*0.011+1.3))*(1-0.36*dryAt(progressAt(z)));
const waveH=(x,z,t,a)=>a*(0.10*Math.sin(x*0.5+t*1.2)+0.08*Math.sin(z*0.4+t*2.0)+0.05*Math.sin((x+z)*0.9+t*2.6));

/* ============================================================
   GAME STATE
   ============================================================ */
let T=0; // tempo de animação global
const G={state:'menu',t:0,ti:0,endDelay:0,evt:0,phase:0,near:false,endP:0};
const P={z:0,o:0,vo:0,x:riverC(0),s:14,yaw:0,roll:0,pitch:0,waveY:0,stamina:1,exhausted:false,ph:0,hitCD:0,shake:0,kick:0};
const C={D:CFG.startGap,o:0,x:0,z:0,yaw:0,surf:0,surfTarget:0,emerged:false,diving:false,diveT:0,nextDive:16,nextSurge:12,surgeT:0,beatT:0,vC:14,prevO:0};
const env={rain:0.45,flash:0,danger:0,bz:0,warm:0,p:0};
const waveAmp=()=>0.9+0.9*env.rain+1.5*env.bz;
const kb={left:false,right:false,up:false,down:false}, tc={left:false,right:false,up:false,down:false}, inp={left:false,right:false,up:false,down:false};

/* ============================================================
   SCENE
   ============================================================ */
const app=$('app');
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.setClearColor(CFG.fog);
app.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const fogBase=new THREE.Color(CFG.fog), fogFlash=new THREE.Color(0x9fb0c8), fogTmp=new THREE.Color();
const fogCool=new THREE.Color(CFG.fog),fogWarm=new THREE.Color(0x7d5c48),zenCool=new THREE.Color(0x0c1412),zenWarm=new THREE.Color(0x2c2538);
const hemiCool=new THREE.Color(0x8fa6a8),hemiWarm=new THREE.Color(0xd9a070),sunCool=new THREE.Color(0xaab8c0),sunWarm=new THREE.Color(0xffb070);
scene.fog=new THREE.FogExp2(CFG.fog,0.0105);
const dummy=new THREE.Object3D(), colTmp=new THREE.Color();

/* ============================================================
   CAMERA
   ============================================================ */
const camera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,0.3,700);
const rearCam=new THREE.PerspectiveCamera(74,16/7,0.2,500);
let camYaw=0,camX=P.x,camY=3.4;

/* ============================================================
   LIGHTING
   ============================================================ */
const hemi=new THREE.HemisphereLight(0x8fa6a8,0x1c2a1f,0.62);
const sun=new THREE.DirectionalLight(0xaab8c0,0.55);
sun.position.set(-30,60,25);
scene.add(hemi,sun);

/* Céu: gradiente + nuvens procedurais + clarão do relâmpago */
const NOISE_GLSL=`
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}`;
const skyMat=new THREE.ShaderMaterial({
  side:THREE.BackSide,depthWrite:false,fog:false,
  uniforms:{uTime:{value:0},uFlash:{value:0},uHorizon:{value:new THREE.Color(CFG.fog)},uZenith:{value:new THREE.Color(0x0c1412)}},
  vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying vec3 vDir;uniform float uTime,uFlash;uniform vec3 uHorizon,uZenith;
  ${NOISE_GLSL}
  float fbm(vec2 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){s+=a*vnoise(p);p*=2.03;a*=0.5;}return s;}
  void main(){
    vec3 d=normalize(vDir);
    float h=clamp(d.y,0.0,1.0);
    vec3 col=mix(uHorizon,uZenith,pow(h,0.5));
    vec2 uv=d.xz/(max(d.y,0.0)+0.4)*1.4+vec2(uTime*0.012,uTime*0.006);
    float c=fbm(uv*1.6);
    col*=0.7+0.65*c;
    col+=vec3(0.5,0.58,0.75)*uFlash*(0.4+c)*(0.3+h);
    gl_FragColor=vec4(col,1.0);
  }`
});
const sky=new THREE.Mesh(new THREE.SphereGeometry(450,24,14),skyMat);
sky.frustumCulled=false; sky.renderOrder=-1; scene.add(sky);

/* ============================================================
   RIVER (água procedural + margens)
   ============================================================ */
const waterMat=new THREE.ShaderMaterial({
  fog:true,
  uniforms:THREE.UniformsUtils.merge([THREE.UniformsLib.fog,{
    uTime:{value:0},uAmp:{value:1},uRain:{value:0.4},uFlash:{value:0},uSpeed:{value:14},
    uSky:{value:new THREE.Color(CFG.fog)},uCanoe:{value:new THREE.Vector2()},uCroc:{value:new THREE.Vector2(0,9999)},uCrocVis:{value:0}
  }]),
  vertexShader:`
  uniform float uTime,uAmp;varying vec3 vWorld;
  #include <fog_pars_vertex>
  float waveH(vec2 p,float t){return uAmp*(0.10*sin(p.x*0.5+t*1.2)+0.08*sin(p.y*0.4+t*2.0)+0.05*sin((p.x+p.y)*0.9+t*2.6));}
  void main(){
    vec4 wp=modelMatrix*vec4(position,1.0);
    wp.y+=waveH(wp.xz,uTime);
    vWorld=wp.xyz;
    vec4 mvPosition=viewMatrix*wp;
    gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
  }`,
  fragmentShader:`
  uniform float uTime,uAmp,uRain,uFlash,uSpeed,uCrocVis;
  uniform vec3 uSky;uniform vec2 uCanoe,uCroc;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  float waveH(vec2 p,float t){return uAmp*(0.10*sin(p.x*0.5+t*1.2)+0.08*sin(p.y*0.4+t*2.0)+0.05*sin((p.x+p.y)*0.9+t*2.6));}
  /* esteira em V atrás de um objeto que avança para -z */
  float wake(vec2 p,vec2 o,float len,float k,float amt){
    vec2 d=p-o;
    float behind=smoothstep(-0.5,1.5,d.y)*(1.0-smoothstep(len*0.5,len,d.y));
    float w=0.55+max(d.y,0.0)*k;
    float lines=smoothstep(0.45,0.0,abs(abs(d.x)-w));
    float core=smoothstep(w,0.0,abs(d.x))*0.35;
    float n=0.55+0.7*vnoise(p*vec2(1.6,0.7)+vec2(0.0,uTime*1.5));
    return (lines*0.9+core)*behind*n*amt;
  }
  float rings(vec2 p,vec2 o,float amt){
    float d=length(p-o);
    return smoothstep(0.6,1.0,sin(d*3.2-uTime*4.5))*exp(-d*0.28)*smoothstep(0.0,1.2,d)*amt;
  }
  void main(){
    vec2 p=vWorld.xz;
    float e=0.3;
    float h0=waveH(p,uTime),hx=waveH(p+vec2(e,0.0),uTime),hz=waveH(p+vec2(0.0,e),uTime);
    vec2 grad=vec2(hx-h0,hz-h0)/e;
    float r1=vnoise(p*1.7+vec2(0.0,uTime*1.1));
    float r2=vnoise(p*3.9+vec2(uTime*0.7,uTime*0.4));
    grad+=vec2(r1-0.5,r2-0.5)*(0.10+0.16*uRain);
    float ring=0.0;
    for(int k=0;k<2;k++){
      float sc=2.0+float(k)*1.9;
      vec2 q=p*sc+vec2(float(k)*17.3,float(k)*9.1);
      vec2 g=floor(q),f=fract(q);
      float hh=hash(g+float(k)*3.7);
      float tt=fract(uTime*0.9+hh*7.0);
      vec2 c=vec2(hash(g+1.7),hash(g+3.1))*0.6+0.2;
      float d=length(f-c);
      ring+=smoothstep(0.07,0.0,abs(d-tt*0.45))*(1.0-tt)*step(hh,uRain*0.85);
    }
    vec3 N=normalize(vec3(-grad.x,1.0,-grad.y));
    vec3 V=normalize(cameraPosition-vWorld);
    float fres=pow(1.0-max(dot(N,V),0.0),3.0);
    vec3 deep=vec3(0.085,0.095,0.06);
    vec3 col=mix(deep,uSky*1.1,0.10+0.85*fres);
    vec3 Lg=normalize(vec3(-0.35,0.75,0.45));
    float spec=pow(max(dot(N,normalize(Lg+V)),0.0),70.0);
    col+=spec*(0.12+uFlash*1.2);
    float fs=vnoise(vec2(p.x*0.7,p.y*0.16));
    float foam=smoothstep(0.66,0.88,fs)*vnoise(p*2.3)*0.35;
    float kk=clamp(uSpeed/20.0,0.35,1.5);
    float wk=wake(p,uCanoe,26.0,0.17,kk)+rings(p,uCanoe,0.35);
    float wc=(wake(p,uCroc,22.0,0.14,1.0)+rings(p,uCroc,0.45))*uCrocVis;
    float foamAll=foam+wk*0.9+wc*0.9+ring*0.28;
    col=mix(col,vec3(0.62,0.68,0.66)+uFlash*0.3,clamp(foamAll,0.0,0.8)*0.65);
    col+=uFlash*vec3(0.12,0.14,0.2)*(0.3+fres);
    gl_FragColor=vec4(col,1.0);
    #include <fog_fragment>
  }`
});
const waterGeo=new THREE.PlaneGeometry(520,560,96,112); waterGeo.rotateX(-Math.PI/2);
const water=new THREE.Mesh(waterGeo,waterMat); water.frustumCulled=false; scene.add(water);

/* Margens: faixa dinâmica que acompanha a canoa (lama + mata) */
const BANK_ROWS=105,BANK_STEP=3.2,BANK_COLS=5,BANK_AHEAD=38;
const BANK_DIST=[-4,0,4,16,70],BANK_H=[-0.9,0.15,0.8,2.2,5.0];
function bankY(d){
  if(d<=BANK_DIST[0])return BANK_H[0];
  for(let i=1;i<BANK_COLS;i++){if(d<=BANK_DIST[i]){return lerp(BANK_H[i-1],BANK_H[i],(d-BANK_DIST[i-1])/(BANK_DIST[i]-BANK_DIST[i-1]));}}
  return BANK_H[BANK_COLS-1];
}
const bankMat=new THREE.MeshLambertMaterial({vertexColors:true});
const banks=[-1,1].map(side=>{
  const n=BANK_ROWS*BANK_COLS,geo=new THREE.BufferGeometry(),idx=[];
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3));
  geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(n*3),3));
  for(let j=0;j<BANK_ROWS-1;j++)for(let i=0;i<BANK_COLS-1;i++){
    const a=j*BANK_COLS+i,b=a+1,c=a+BANK_COLS,d=c+1;
    if(side>0)idx.push(a,b,c,b,d,c);else idx.push(a,c,b,b,c,d);
  }
  geo.setIndex(idx);
  const m=new THREE.Mesh(geo,bankMat);m.frustumCulled=false;scene.add(m);
  return {side,mesh:m};
});
const BANK_COL=[[.10,.075,.045],[.17,.12,.07],[.10,.17,.07],[.06,.12,.06],[.04,.08,.045]];
const MUD=[.16,.11,.065],DRY=[.34,.25,.15];
let bankBase=null;
function updateBanks(){
  const base=Math.floor(P.z/BANK_STEP);
  if(base===bankBase)return;bankBase=base;
  for(const b of banks){
    const pos=b.mesh.geometry.attributes.position.array,col=b.mesh.geometry.attributes.color.array;
    for(let j=0;j<BANK_ROWS;j++){
      const row=base+BANK_AHEAD-j,z=row*BANK_STEP,c=riverC(z),hw=riverW(z)/2;
      const mud=hash1(row*0.73+b.side*5.1)>0.55?1:0;
      const dry=dryAt(progressAt(z));
      for(let i=0;i<BANK_COLS;i++){
        const k=(j*BANK_COLS+i)*3,d=BANK_DIST[i];
        pos[k]=c+b.side*(hw+d);
        pos[k+1]=BANK_H[i]+(i>0?(hash1(row*1.7+i*3.1+b.side)-0.5)*(0.3+i*0.25):0);
        pos[k+2]=z;
        const jit=0.85+0.3*hash1(row*2.3+i*1.3+b.side*9);
        let cc=BANK_COL[i];
        if(i===2&&mud)cc=MUD;
        if(i===3&&mud&&hash1(row*0.31)>0.5)cc=MUD;
        const dr=(i<=3?0.85:0.3)*dry;
        col[k]=lerp(cc[0],DRY[0],dr)*jit;col[k+1]=lerp(cc[1],DRY[1],dr)*jit;col[k+2]=lerp(cc[2],DRY[2],dr)*jit;
      }
    }
    b.mesh.geometry.attributes.position.needsUpdate=true;
    b.mesh.geometry.attributes.color.needsUpdate=true;
    b.mesh.geometry.computeVertexNormals();
  }
}

function makeBag(){ // mochila do remédio (cruz vermelha)
  const g=new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4,0.34,0.16),new THREE.MeshLambertMaterial({color:0xefe9d8})));
  const red=new THREE.MeshBasicMaterial({color:0xd0352b});
  const a=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.05,0.01),red),b=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.2,0.01),red);
  a.position.z=b.position.z=0.085;g.add(a,b);return g;
}
/* ============================================================
   CANOE
   ============================================================ */
const canoeG=new THREE.Group();canoeG.rotation.order='YXZ';scene.add(canoeG);
const paddleG=new THREE.Group(),riderG=new THREE.Group();
(function buildCanoe(){
  const N=18,M=9,L=5.6,pos=[],idx=[];
  for(let i=0;i<=N;i++){
    const t=i/N,e=Math.abs(2*t-1);
    const hw=0.62*Math.pow(1-Math.pow(e,2.4),0.55)+0.03;
    const top=0.35+0.5*Math.pow(e,3),bot=-0.25+0.45*Math.pow(e,2.2);
    for(let j=0;j<=M;j++){const a=j/M*Math.PI;pos.push(-hw*Math.cos(a),top-(top-bot)*Math.sin(a),(t-0.5)*L);}
  }
  for(let i=0;i<N;i++)for(let j=0;j<M;j++){const a=i*(M+1)+j,b=a+1,c=a+M+1,d=c+1;idx.push(a,c,b,b,c,d);}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
  const hull=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:0x6a4527,side:THREE.DoubleSide}));
  canoeG.add(hull);
  const wood=new THREE.MeshLambertMaterial({color:0x4a3220});
  [-0.9,1.1].forEach(z=>{const b=new THREE.Mesh(new THREE.BoxGeometry(1.25,0.06,0.2),wood);b.position.set(0,0.3,z);canoeG.add(b);});
  // remador com capa de chuva amarela
  const poncho=new THREE.MeshLambertMaterial({color:0xd9b536});
  const body=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.34,0.8,8),poncho);body.position.set(0,0.62,0.35);riderG.add(body);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.17,10,8),new THREE.MeshLambertMaterial({color:0x8a5a3a}));head.position.set(0,1.18,0.35);riderG.add(head);
  const hood=new THREE.Mesh(new THREE.SphereGeometry(0.2,10,8,0,Math.PI*2,0,Math.PI*0.6),poncho);hood.position.set(0,1.22,0.37);riderG.add(hood);
  const bag=makeBag();bag.position.set(0,0.72,0.62);riderG.add(bag);
  // remo
  canoeG.add(riderG);paddleG.position.set(0,0.95,0.35);riderG.add(paddleG);
  const shaft=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,2.3,6),wood);shaft.position.y=-0.5;paddleG.add(shaft);
  const blade=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.55,0.04),wood);blade.position.y=-1.55;paddleG.add(blade);
  // lampião
  const lamp=new THREE.Mesh(new THREE.SphereGeometry(0.1,8,6),new THREE.MeshBasicMaterial({color:0xffc860}));lamp.position.set(0,0.75,-2.35);canoeG.add(lamp);
})();

/* ============================================================
   CROCODILE
   ============================================================ */
const crocG=new THREE.Group();crocG.scale.setScalar(0.85);scene.add(crocG);
const crocTail=[];let jawG,crocEyes;
const CROC_TIP=5.55*0.85; // distância do centro até a ponta do focinho
(function buildCroc(){
  const skin=new THREE.MeshLambertMaterial({color:0x4a5a2c,flatShading:true});
  const dark=new THREE.MeshLambertMaterial({color:0x2f3a1d,flatShading:true});
  const body=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),skin);body.scale.set(0.95,0.55,3.0);body.position.y=0.1;crocG.add(body);
  const headG=new THREE.Group();headG.position.set(0,0.08,-2.7);crocG.add(headG);
  const skull=new THREE.Mesh(new THREE.BoxGeometry(1.15,0.5,1.5),skin);skull.position.set(0,0.2,-0.6);headG.add(skull);
  const snout=new THREE.Mesh(new THREE.BoxGeometry(0.7,0.28,1.7),skin);snout.position.set(0,0.12,-2.0);headG.add(snout);
  jawG=new THREE.Group();jawG.position.set(0,-0.08,-0.2);headG.add(jawG);
  const jaw=new THREE.Mesh(new THREE.BoxGeometry(0.62,0.14,2.4),dark);jaw.position.set(0,0,-1.2);jawG.add(jaw);
  crocEyes=[-1,1].map(s=>{
    const brow=new THREE.Mesh(new THREE.SphereGeometry(0.17,8,6),skin);brow.position.set(s*0.38,0.48,-0.65);headG.add(brow);
    const eye=new THREE.Mesh(new THREE.SphereGeometry(0.1,8,6),new THREE.MeshBasicMaterial({color:0xf2dc4a}));eye.position.set(s*0.4,0.58,-0.72);headG.add(eye);return eye;
  });
  // dentes (instanciados) – superiores e inferiores
  const toothGeo=new THREE.ConeGeometry(0.04,0.16,4),toothMat=new THREE.MeshLambertMaterial({color:0xe8e6d0});
  const up=new THREE.InstancedMesh(toothGeo,toothMat,12),lo=new THREE.InstancedMesh(toothGeo,toothMat,12);
  let n=0;
  for(const s of[-1,1])for(let k=0;k<6;k++){
    dummy.position.set(s*0.3,-0.04,-0.9-k*0.33);dummy.rotation.set(Math.PI,0,0);dummy.scale.set(1,1,1);dummy.updateMatrix();up.setMatrixAt(n,dummy.matrix);
    dummy.position.set(s*0.26,0.1,-0.4-k*0.35);dummy.rotation.set(0,0,0);dummy.updateMatrix();lo.setMatrixAt(n,dummy.matrix);n++;
  }
  up.frustumCulled=lo.frustumCulled=false;headG.add(up);jawG.add(lo);
  // placas dorsais
  const scGeo=new THREE.ConeGeometry(0.1,0.3,4),sc=new THREE.InstancedMesh(scGeo,dark,22);
  n=0;
  for(let z=-2.2;z<=2.8&&n<22;z+=0.5)for(const s of[-1,1]){
    const k=Math.sqrt(Math.max(0,1-(z/3)*(z/3)));
    dummy.position.set(s*0.2,0.1+0.55*k+0.04,z);dummy.rotation.set(0,0,s*0.2);dummy.scale.set(1,1,1);dummy.updateMatrix();sc.setMatrixAt(n++,dummy.matrix);
  }
  sc.count=n;sc.frustumCulled=false;crocG.add(sc);
  // cauda articulada
  let parent=crocG,zOff=2.7;
  for(let i=0;i<5;i++){
    const r=0.62*(1-i*0.17)+0.05,g=new THREE.Group();g.position.set(0,i?0:0.1,zOff);parent.add(g);
    const geo=new THREE.CylinderGeometry(r*0.8,r,0.85,6);geo.rotateX(Math.PI/2);geo.translate(0,0,0.42);
    const m=new THREE.Mesh(geo,i%2?dark:skin);m.scale.y=0.7;g.add(m);crocTail.push(g);parent=g;zOff=0.85;
  }
  crocG.visible=false;
})();

/* ============================================================
   FOREST (InstancedMesh + reciclagem)
   ============================================================ */
const lamb=new THREE.MeshLambertMaterial({color:0xffffff});
function makeInst(geo,count){const m=new THREE.InstancedMesh(geo,lamb,count);m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(m);return m;}
const vineGeo=new THREE.CylinderGeometry(0.05,0.05,1,3);vineGeo.translate(0,-0.5,0);
const trunkGeo=new THREE.CylinderGeometry(0.45,0.8,1,6);trunkGeo.translate(0,0.5,0);
const logGeo=new THREE.CylinderGeometry(0.4,0.46,1,6);logGeo.rotateX(Math.PI/2);
const trunks=makeInst(trunkGeo,CFG.forestN),crowns=makeInst(new THREE.IcosahedronGeometry(1,1),CFG.forestN*2),vines=makeInst(vineGeo,CFG.forestN*2);
const bushes=makeInst(new THREE.IcosahedronGeometry(1,0),CFG.bushN),rocks=makeInst(new THREE.DodecahedronGeometry(1,0),CFG.rockN),shoreLogs=makeInst(logGeo,CFG.logN);
const treeZ=new Float32Array(CFG.forestN),bushZ=new Float32Array(CFG.bushN),rockZ=new Float32Array(CFG.rockN),logZ=new Float32Array(CFG.logN),treeX=new Float32Array(CFG.forestN),bushX=new Float32Array(CFG.bushN),rockX=new Float32Array(CFG.rockN),logX=new Float32Array(CFG.logN);
const FOREST_BEHIND=120,FOREST_AHEAD=250,SPAN=FOREST_BEHIND+FOREST_AHEAD;
const sidePick=()=>Math.random()<0.5?-1:1;
function put(mesh,i,x,y,z,rx,ry,rz,sx,sy,sz,h,s,l){
  dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();
  mesh.setMatrixAt(i,dummy.matrix);colTmp.setHSL(h,s,l);mesh.setColorAt(i,colTmp);
}
function placeTree(i,z){
  treeZ[i]=z;const side=sidePick(),hw=riverW(z)/2;
  const dist=1.8+(Math.random()<0.55?Math.random()*7:7+Math.random()*38)+(nearVillage(z)?40:0);
  const x=riverC(z)+side*(hw+dist),h=rand(13,24),r=rand(0.9,1.5),y0=bankY(dist)-0.8;treeX[i]=x;
  put(trunks,i,x,y0,z,rand(-.04,.04),rand(0,6.28),rand(-.04,.04),r,h,r,0.075+rand(0,0.03),0.22+rand(0,.1),0.12+rand(0,.07));
  const cs=rand(4.5,8),cy=rand(2.4,3.6);
  put(crowns,2*i,x,y0+h,z,0,rand(0,6.28),0,cs,cy,cs*rand(.85,1.15),0.26+rand(0,.06),0.38+rand(0,.2),0.10+rand(0,.08));
  put(crowns,2*i+1,x+rand(-3,3),y0+h-rand(1,4),z+rand(-3,3),0,rand(0,6.28),0,cs*.7,cy*.8,cs*.7,0.27+rand(0,.06),0.4+rand(0,.2),0.09+rand(0,.08));
  for(let k=0;k<2;k++)put(vines,2*i+k,x-side*rand(0.5,cs*0.8),y0+h-cy*0.4,z+rand(-cs,cs)*0.6,0,0,0,1,rand(4,11),1,0.25,0.4,0.12);
}
function placeBush(i,z){
  bushZ[i]=z;const side=sidePick(),dist=rand(0.6,9)+(nearVillage(z)?40:0),x=riverC(z)+side*(riverW(z)/2+dist),s=rand(1,2.6);bushX[i]=x;
  put(bushes,i,x,bankY(dist)+0.1,z,0,rand(0,6.28),0,s*rand(1,1.6),s*rand(.6,1),s*rand(1,1.6),0.24+rand(0,.08),0.45+rand(0,.2),0.13+rand(0,.1));
}
function placeRock(i,z){
  rockZ[i]=z;const side=sidePick(),dist=rand(-1.8,3.5)+(nearVillage(z)?40:0),x=riverC(z)+side*(riverW(z)/2+dist),s=rand(0.7,2);rockX[i]=x;
  put(rocks,i,x,bankY(dist),z,rand(0,3),rand(0,6),rand(0,3),s,s*0.7,s,0.1,0.05+rand(0,.05),0.2+rand(0,.12));
}
function placeLog(i,z){
  logZ[i]=z;const side=sidePick(),dist=rand(0,5)+(nearVillage(z)?40:0),x=riverC(z)+side*(riverW(z)/2+dist);logX[i]=x;
  put(shoreLogs,i,x,bankY(dist)+0.2,z,0,rand(-0.4,0.4),0,1,1,rand(4,9),0.07,0.25,0.12+rand(0,.07));
}
function flagForest(){for(const m of[trunks,crowns,vines,bushes,rocks,shoreLogs]){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}}
function rebuildForest(){
  const z0=P.z+FOREST_BEHIND;
  for(let i=0;i<CFG.forestN;i++)placeTree(i,z0-Math.random()*SPAN);
  for(let i=0;i<CFG.bushN;i++)placeBush(i,z0-Math.random()*SPAN);
  for(let i=0;i<CFG.rockN;i++)placeRock(i,z0-Math.random()*SPAN);
  for(let i=0;i<CFG.logN;i++)placeLog(i,z0-Math.random()*SPAN);
  flagForest();
}
rebuildForest();
function updateForest(){
  const lim=P.z+FOREST_BEHIND;let dirty=false;
  for(let i=0;i<CFG.forestN;i++)if(treeZ[i]>lim){placeTree(i,treeZ[i]-SPAN);dirty=true;}
  for(let i=0;i<CFG.bushN;i++)if(bushZ[i]>lim){placeBush(i,bushZ[i]-SPAN);dirty=true;}
  for(let i=0;i<CFG.rockN;i++)if(rockZ[i]>lim){placeRock(i,rockZ[i]-SPAN);dirty=true;}
  for(let i=0;i<CFG.logN;i++)if(logZ[i]>lim){placeLog(i,logZ[i]-SPAN);dirty=true;}
  if(dirty)flagForest();
}

/* Obstáculos do rio: troncos, pedras, camalotes (vegetação flutuante) e bancos de areia */
const OB={pool:[],front:0,on:false};
const KINDS=['log','rock','camalote','sand'];
const KIND_W=[[0.45,0.2,0.35,0],[0.5,0.25,0.25,0],[0.3,0.12,0.18,0.4]]; // pesos por fase
(function(){
  const lg=new THREE.CylinderGeometry(0.4,0.46,1,7);lg.rotateX(Math.PI/2);
  const defs={
    log:[lg,new THREE.MeshLambertMaterial({color:0x4b3827,flatShading:true}),6],
    rock:[new THREE.DodecahedronGeometry(1,0),new THREE.MeshLambertMaterial({color:0x5a5d5c,flatShading:true}),4],
    camalote:[new THREE.IcosahedronGeometry(1,1),new THREE.MeshLambertMaterial({color:0x4a8a30,flatShading:true}),5],
    sand:[new THREE.CylinderGeometry(1,1,0.3,16),new THREE.MeshLambertMaterial({color:0xb89a64,flatShading:true}),6]
  };
  for(const kind of KINDS){const d=defs[kind];for(let i=0;i<d[2];i++){
    const mesh=new THREE.Mesh(d[0],d[1]);mesh.visible=false;scene.add(mesh);
    OB.pool.push({kind,mesh,active:false,hw:1,hl:1,r:1,x:0,z:1e9,rot:0,ph:Math.random()*6,inside:false});
  }}
})();
function pickKind(ph){const w=KIND_W[ph];let r=Math.random(),i=0;for(;i<3;i++){if(r<w[i])break;r-=w[i];}return KINDS[i];}
function placeObstacle(o,z){
  const hw=riverW(z)/2-6;
  let off=Math.random()<0.4?P.o+rand(-8,8):rand(-hw,hw);
  if(o.kind==='sand'&&Math.random()<0.5)off=(Math.random()<0.5?-1:1)*rand(hw*0.35,hw);
  off=clamp(off,-hw,hw);
  o.z=z;o.x=riverC(z)+off;o.inside=false;o.active=true;
  const m=o.mesh;
  if(o.kind==='log'){const len=rand(4,7),rad=rand(0.8,1.2);m.scale.set(rad,rad,len);o.rot=rand(-0.6,0.6);o.hw=0.45*rad+0.2;o.hl=len/2;}
  else if(o.kind==='rock'){const r=rand(1,1.7);m.scale.set(r,r*0.75,r);o.rot=rand(0,6);o.hw=o.hl=r*0.9;}
  else if(o.kind==='camalote'){const r=rand(2.2,4.2);m.scale.set(r,0.28,r*rand(0.8,1.2));o.rot=rand(0,6);o.r=r*0.9;}
  else{const r=rand(3,6.5);m.scale.set(r,1,r*rand(0.7,1.1));o.rot=rand(0,6);o.r=r*0.9;}
  m.rotation.set(0,o.rot,0);m.visible=true;
}
function spawnOne(){
  const z=OB.front-lerp(48,24,smooth(progressAt(OB.front)*1.2))*rand(0.75,1.3);
  if(z<zEnd()+60){OB.on=false;return false;} // área da vila fica livre
  const kind=pickKind(phaseOf(progressAt(z)));
  const o=OB.pool.find(q=>!q.active&&q.kind===kind);
  OB.front=z;
  if(o)placeObstacle(o,z);
  return true;
}
function resetObstacles(active){
  OB.front=P.z-100;OB.on=!!active;
  for(const o of OB.pool){o.active=false;o.mesh.visible=false;o.z=1e9;o.inside=false;}
}
function updateObstacles(dt){
  const amp=waveAmp(),playing=G.state==='playing';
  if(OB.on)for(let n=0;n<8&&OB.front>P.z-240;n++)if(!spawnOne())break;
  for(const o of OB.pool){
    if(!o.active)continue;
    if(o.z>P.z+30){o.active=false;o.mesh.visible=false;continue;}
    const bob=waveH(o.x,o.z,T,amp)*0.8;
    const y=o.kind==='log'?0.1+bob:o.kind==='rock'?0.15+bob:o.kind==='camalote'?0.06+bob*0.9:0.1;
    o.mesh.position.set(o.x,y+Math.sin(T*1.3+o.ph)*0.03,o.z);
    if(!playing)continue;
    const dx=P.x-o.x,dz=P.z-o.z;
    if(o.kind==='log'||o.kind==='rock'){
      if(P.hitCD>0)continue;
      const c=Math.cos(o.rot),s=Math.sin(o.rot),lx=dx*c-dz*s,lz=dx*s+dz*c;
      if(Math.abs(lx)<o.hw+0.65&&Math.abs(lz)<o.hl+2.0){
        P.s=Math.max(CFG.vMin*0.8,P.s*0.45);P.vo+=(dx>=0?1:-1)*6;P.shake=Math.max(P.shake,0.9);P.hitCD=0.8;
        SFX.thud();emitSpray(P.x,0.3,P.z,22,4,6);
      }
    }else{
      const inside=Math.hypot(dx,dz)<o.r+0.8;
      if(inside){
        if(o.kind==='camalote')P.s=Math.max(P.s-16*dt,8);
        else{P.s=Math.max(P.s-30*dt,5);P.stamina=Math.max(0,P.stamina-0.1*dt);P.shake=Math.max(P.shake,0.25);}
        if(!o.inside){
          if(o.kind==='sand'){SFX.scrape();toast('ENCALHOU! Saia do banco de areia!');}
          else SFX.leaf();
          emitSpray(P.x,0.2,P.z,8,2,3);
        }
      }
      o.inside=inside;
    }
  }
}

/* Sucuri: cobra que atravessa o rio de uma margem à outra */
const SN={active:false,N:18,mesh:null,x0:0,z:0,dir:1,speed:4.6,age:0,hitCD:0,next:99,pts:[]};
(function(){
  SN.mesh=makeInst(new THREE.SphereGeometry(1,8,6),SN.N);SN.mesh.visible=false;
  for(let k=0;k<SN.N;k++){
    colTmp.setHSL(0.12,0.4,k===0?0.09:(k%3===0?0.2:0.12));SN.mesh.setColorAt(k,colTmp);
    SN.pts.push({x:0,z:0,r:0.3});
    dummy.position.set(0,-50,0);dummy.rotation.set(0,0,0);dummy.scale.set(0.1,0.1,0.1);dummy.updateMatrix();SN.mesh.setMatrixAt(k,dummy.matrix);
  }
  SN.mesh.instanceColor.needsUpdate=true;
})();
function spawnSnake(){
  const z=P.z-150,hw=riverW(z)/2,side=Math.random()<0.5?-1:1;
  SN.active=true;SN.z=z;SN.dir=-side;SN.x0=riverC(z)+side*(hw+3);SN.age=0;SN.hitCD=0;SN.mesh.visible=true;
  SN.next=G.phase>=2?rand(12,18):rand(16,24);
  toast('🐍 Sucuri cruzando o rio à frente!');SFX.hiss();
}
function resetSnake(){SN.active=false;SN.mesh.visible=false;SN.next=rand(9,13);}
function updateSnake(dt){
  if(G.state==='playing'&&G.phase>=1&&!SN.active){SN.next-=dt;if(SN.next<=0&&P.z-150>zEnd()+90)spawnSnake();}
  if(!SN.active)return;
  SN.age+=dt;
  const hx=SN.x0+SN.dir*SN.speed*SN.age,amp=waveAmp();
  for(let k=0;k<SN.N;k++){
    const x=hx-SN.dir*k*0.85,z=SN.z+1.4*Math.sin(T*3-k*0.55)*(0.35+k/SN.N*0.65);
    const r=k===0?0.45:lerp(0.38,0.13,k/SN.N);
    const y=(k<3?0.38-0.1*k:0.05)+waveH(x,z,T,amp)*0.8+(k>=3?0.04*Math.sin(T*2+k):0);
    const q=SN.pts[k];q.x=x;q.z=z;q.r=r;
    dummy.position.set(x,y,z);
    if(k===0){dummy.rotation.set(0,SN.dir>0?Math.PI/2:-Math.PI/2,0);dummy.scale.set(0.42,0.26,0.62);}
    else{dummy.rotation.set(0,0,0);dummy.scale.set(r,r*0.9,r);}
    dummy.updateMatrix();SN.mesh.setMatrixAt(k,dummy.matrix);
  }
  SN.mesh.instanceMatrix.needsUpdate=true;
  const tailX=hx-SN.dir*SN.N*0.85,far=riverC(SN.z)+SN.dir*(riverW(SN.z)/2+3);
  if((SN.dir>0?tailX>far:tailX<far)||SN.z>P.z+30){SN.active=false;SN.mesh.visible=false;return;}
  SN.hitCD-=dt;
  if(G.state==='playing'&&SN.hitCD<=0){
    for(const q of SN.pts){
      if(Math.hypot(P.x-q.x,P.z-q.z)<q.r+1.0||Math.hypot(P.x-q.x,P.z+1.8-q.z)<q.r+0.8||Math.hypot(P.x-q.x,P.z-1.8-q.z)<q.r+0.8){
        SN.hitCD=1.4;P.s=Math.max(CFG.vMin*0.7,P.s*0.4);P.stamina=Math.max(0,P.stamina-0.3);P.shake=Math.max(P.shake,1.0);
        SFX.hiss();SFX.thud();emitSpray(P.x,0.3,P.z,20,4,5);toast('🐍 A sucuri te enroscou! Reme!');
        break;
      }
    }
  }
}

/* Banzeiro: ondas grandes que jogam a canoa de lado */
const BZ={state:0,t:0,next:99,ph:0,k:1};
function startBanzeiro(){
  BZ.state=1;BZ.t=0;BZ.ph=rand(0,6.28);BZ.k=G.phase>=2?0.7:1;
  showBanner('BANZEIRO!','Segure firme — ondas vindo de lado');SFX.banzeiro();
}
function resetBanzeiro(){BZ.state=0;BZ.next=99;env.bz=0;}
function updateBanzeiro(dt){
  if(G.state==='playing'&&G.phase>=1){
    if(BZ.state===0){BZ.next-=dt;if(BZ.next<=0)startBanzeiro();}
    else{BZ.t+=dt;if(BZ.t>8.2){BZ.state=0;BZ.next=G.phase>=2?rand(20,28):rand(12,18);}}
  }else if(G.state!=='playing')BZ.state=0;
  let e=0;
  if(BZ.state===1){const t=BZ.t;e=t<2.2?0.25*smooth(t/2.2):t<3.2?lerp(0.25,1,smooth(t-2.2)):t<6.2?1:smooth(1-(t-6.2)/2.0);}
  env.bz=damp(env.bz,e*BZ.k,3,dt);
}

/* ============================================================
   RAIN (linhas em shader) + respingos
   ============================================================ */
const rainMat=new THREE.ShaderMaterial({
  transparent:true,depthWrite:false,
  uniforms:{uTime:{value:0},uWind:{value:5},uSpeed:{value:30},uInt:{value:0.4},uCenter:{value:new THREE.Vector3()},uBox:{value:new THREE.Vector3(46,30,60)},uColor:{value:new THREE.Color(0xb8cad2)}},
  vertexShader:`attribute float aEnd;uniform float uTime,uWind,uSpeed,uInt;uniform vec3 uCenter,uBox;varying float vA;
  float h3(vec3 s){return fract(sin(dot(s,vec3(12.9898,78.233,37.719)))*43758.5453);}
  void main(){
    vec3 s=position;
    float fall=uSpeed*(0.8+0.4*h3(s.zyx));
    vec3 q=s*uBox;
    float y=mod(q.y-uTime*fall,uBox.y)-1.0;
    float x=uCenter.x+mod(q.x+uWind*uTime-uCenter.x+uBox.x*0.5,uBox.x)-uBox.x*0.5;
    float z=uCenter.z+mod(q.z-uCenter.z+uBox.z*0.5,uBox.z)-uBox.z*0.5;
    vec3 p=vec3(x,y,z);
    p+=vec3(-uWind,fall,0.0)*0.032*aEnd;
    float dist=length(cameraPosition-p);
    vA=step(h3(s),uInt)*mix(0.55,0.12,aEnd)*exp(-pow(dist*0.011,2.0));
    gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);
  }`,
  fragmentShader:`uniform vec3 uColor;varying float vA;void main(){if(vA<0.01)discard;gl_FragColor=vec4(uColor,vA);}`
});
(function(){
  const n=CFG.rainN,pos=new Float32Array(n*6),end=new Float32Array(n*2);
  for(let i=0;i<n;i++){const a=Math.random(),b=Math.random(),c=Math.random();
    for(let k=0;k<2;k++){pos.set([a,b,c],(i*2+k)*3);end[i*2+k]=k;}}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('aEnd',new THREE.BufferAttribute(end,1));
  const rain=new THREE.LineSegments(g,rainMat);rain.frustumCulled=false;scene.add(rain);
})();
const spray={geo:new THREE.BufferGeometry(),pos:new Float32Array(CFG.sprayN*3),vel:new Float32Array(CFG.sprayN*3),life:new Float32Array(CFG.sprayN),head:0};
for(let i=0;i<CFG.sprayN;i++)spray.pos[i*3+1]=-100;
spray.geo.setAttribute('position',new THREE.BufferAttribute(spray.pos,3));
const sprayPts=new THREE.Points(spray.geo,new THREE.PointsMaterial({color:0xdfe9e8,size:0.5,transparent:true,opacity:0.55,depthWrite:false}));
sprayPts.frustumCulled=false;scene.add(sprayPts);
function emitSpray(x,y,z,n,vy,vh){
  for(let k=0;k<n;k++){
    const i=spray.head;spray.head=(spray.head+1)%CFG.sprayN;
    spray.pos.set([x+rand(-0.6,0.6),y,z+rand(-0.6,0.6)],i*3);
    spray.vel.set([rand(-vh,vh)*0.5,rand(vy*0.4,vy),rand(-vh,vh)*0.5],i*3);
    spray.life[i]=rand(0.5,1.1);
  }
}
function updateSpray(dt){
  for(let i=0;i<CFG.sprayN;i++){
    if(spray.life[i]<=0)continue;
    spray.life[i]-=dt;const k=i*3;
    spray.vel[k+1]-=14*dt;
    spray.pos[k]+=spray.vel[k]*dt;spray.pos[k+1]+=spray.vel[k+1]*dt;spray.pos[k+2]+=spray.vel[k+2]*dt;
    if(spray.pos[k+1]<0||spray.life[i]<=0){spray.life[i]=0;spray.pos[k+1]=-100;}
  }
  spray.geo.attributes.position.needsUpdate=true;
}

/* Gotas de chuva na "lente" (canvas 2D barato) */
const dropC=$('drops'),dropX=dropC.getContext('2d');let drops=[];
function updateDrops(dt){
  dropX.clearRect(0,0,dropC.width,dropC.height);
  if(drops.length<40&&Math.random()<env.rain*dt*9)drops.push({x:Math.random()*dropC.width,y:Math.random()*dropC.height*0.85,r:rand(2,6),age:0,life:rand(2.5,5),vy:rand(10,35)});
  for(let i=drops.length-1;i>=0;i--){
    const d=drops[i];d.age+=dt;if(d.age>d.life){drops.splice(i,1);continue;}
    const f=d.age/d.life,al=Math.sin(Math.PI*f)*0.55;
    if(d.r>4.2&&f>0.3)d.y+=d.vy*dt*f;
    dropX.beginPath();dropX.ellipse(d.x,d.y,d.r,d.r*1.25,0,0,6.283);
    dropX.fillStyle='rgba(170,200,210,'+(al*0.25)+')';dropX.fill();
    dropX.lineWidth=1;dropX.strokeStyle='rgba(230,245,255,'+(al*0.5)+')';dropX.stroke();
    dropX.beginPath();dropX.arc(d.x-d.r*.3,d.y-d.r*.4,d.r*.25,0,6.283);dropX.fillStyle='rgba(255,255,255,'+(al*0.7)+')';dropX.fill();
  }
}

/* ============================================================
   INTRO (a pessoa sai da floresta e embarca na canoa)
   ============================================================ */
const I={side:1,zc:0,hw:30,d0:20,d1:-0.5,walk:7,seat:8,push:8.5,end:11,wph:0,c0:false,c1:false,c2:false,seated:false,walkYaw:Math.PI/2,S:new THREE.Vector3()};
const camNP=new THREE.Vector3(),camNL=new THREE.Vector3(),vA=new THREE.Vector3(),vB=new THREE.Vector3(),lA=new THREE.Vector3(),lB=new THREE.Vector3(),vSeat=new THREE.Vector3(),vBow=new THREE.Vector3(),vTmp=new THREE.Vector3();
function makeFigure(color,gear){
  const g=new THREE.Group(),parts={};
  const poncho=new THREE.MeshLambertMaterial({color}),pants=new THREE.MeshLambertMaterial({color:0x2b3a35});
  const skin=new THREE.MeshLambertMaterial({color:0x8a5a3a}),wood=new THREE.MeshLambertMaterial({color:0x4a3220});
  const limb=(w,h,mat,x,y)=>{const q=new THREE.Group();q.position.set(x,y,0);const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,w),mat);m.position.y=-h/2;q.add(m);g.add(q);return q;};
  parts.legL=limb(0.17,0.85,pants,-0.1,0.85);parts.legR=limb(0.17,0.85,pants,0.1,0.85);
  parts.armL=limb(0.11,0.62,poncho,-0.3,1.56);parts.armR=limb(0.11,0.62,poncho,0.3,1.56);
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(0.21,0.37,0.85,8),poncho);torso.position.y=1.25;g.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.17,10,8),skin);head.position.y=1.78;g.add(head);
  const hood=new THREE.Mesh(new THREE.SphereGeometry(0.2,10,8,0,Math.PI*2,0,Math.PI*0.6),poncho);hood.position.set(0,1.82,0.02);g.add(hood);
  if(gear==='traveler'){
    const pad=new THREE.Group();pad.position.set(0.38,0.95,-0.05);pad.rotation.z=-0.08;g.add(pad); // remo na mão direita
    const sh=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,2.3,6),wood);sh.position.y=0.4;pad.add(sh);
    const bl=new THREE.Mesh(new THREE.BoxGeometry(0.3,0.55,0.04),wood);bl.position.y=1.7;pad.add(bl);
    const bag=makeBag();bag.position.set(0,1.3,0.28);g.add(bag);
  }else if(gear==='villager'){
    const lamp=new THREE.Mesh(new THREE.SphereGeometry(0.11,8,6),new THREE.MeshBasicMaterial({color:0xffc860}));
    lamp.position.y=-0.68;parts.armL.add(lamp);parts.armL.rotation.x=-0.6;
  }
  return {g,parts};
}
const WK=makeFigure(0xd9b536,'traveler'),walkerG=WK.g,walkParts=WK.parts;
walkerG.visible=false;scene.add(walkerG);
// estaca + corda que prende a canoa à margem
const stakeM=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09,0.9,6),new THREE.MeshLambertMaterial({color:0x3b2a1a}));stakeM.visible=false;scene.add(stakeM);
const ROPE_N=10,ropeGeo=new THREE.BufferGeometry();
ropeGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(ROPE_N*3),3));
const ropeL=new THREE.Line(ropeGeo,new THREE.LineBasicMaterial({color:0x8a7650}));ropeL.frustumCulled=false;ropeL.visible=false;scene.add(ropeL);

/* altura real do terreno da margem (mesma fórmula da malha) */
function bankRowY(row,side,d){
  let i=0;while(i<BANK_COLS-2&&d>BANK_DIST[i+1])i++;
  const f=clamp((d-BANK_DIST[i])/(BANK_DIST[i+1]-BANK_DIST[i]),0,1);
  const y=k=>BANK_H[k]+(k>0?(hash1(row*1.7+k*3.1+side)-0.5)*(0.3+k*0.25):0);
  return lerp(y(i),y(i+1),f);
}
function groundY(side,z,d){const r=z/BANK_STEP,r0=Math.floor(r),f=r-r0;return lerp(bankRowY(r0,side,d),bankRowY(r0+1,side,d),f);}
/* abre uma trilha na mata para a pessoa passar */
function clearCorridor(zc,side){
  const hit=(x,z)=>{const dx=(x-riverC(z))*side;return Math.abs(z-zc)<4.8&&dx>0&&(dx-riverW(z)/2)>-2.5&&(dx-riverW(z)/2)<I.d0+8;};
  for(let i=0;i<CFG.forestN;i++)if(hit(treeX[i],treeZ[i]))placeTree(i,treeZ[i]-SPAN);
  for(let i=0;i<CFG.bushN;i++)if(hit(bushX[i],bushZ[i]))placeBush(i,bushZ[i]-SPAN);
  for(let i=0;i<CFG.rockN;i++)if(hit(rockX[i],rockZ[i]))placeRock(i,rockZ[i]-SPAN);
  for(let i=0;i<CFG.logN;i++)if(hit(logX[i],logZ[i]))placeLog(i,logZ[i]-SPAN);
  flagForest();
}
function updateIntro(dt){
  if(G.state!=='intro')return;
  const t=G.ti,s=I.side;
  canoeG.updateMatrixWorld(true);
  if(t<I.seat){
    if(t<I.walk){
      const u=t/I.walk,u2=Math.min(1,u+0.02);
      const pt=(uu,o)=>{const d=lerp(I.d0,I.d1,uu),z=I.zc+0.3+1.2*Math.sin(d*0.35)*Math.min(1,d/I.d0);o.set(riverC(z)+s*(riverW(z)/2+d),groundY(s,z,d),z);return d;};
      const dist=pt(u,walkerG.position);pt(u2,vTmp);
      I.walkYaw=Math.atan2(-(vTmp.x-walkerG.position.x),-(vTmp.z-walkerG.position.z));
      const old=I.wph;I.wph+=dt*10;const a=Math.sin(I.wph);
      walkParts.legL.rotation.x=a*0.8;walkParts.legR.rotation.x=-a*0.8;
      walkParts.armL.rotation.x=-a*0.5;walkParts.armR.rotation.x=-0.35;
      walkerG.position.y+=Math.abs(a)*0.05;walkerG.rotation.y=I.walkYaw;
      if(Math.floor(I.wph/Math.PI)!==Math.floor(old/Math.PI)){SFX.step();if(dist<1.5)emitSpray(walkerG.position.x,0.05,walkerG.position.z,4,2,1.5);}
      I.S.copy(walkerG.position);
    }else{
      const u=clamp((t-I.walk)/(I.seat-I.walk),0,1),e=smooth(u),sn=Math.sin(Math.PI*u);
      vSeat.set(0,0.35,0.35);canoeG.localToWorld(vSeat);
      walkerG.position.lerpVectors(I.S,vSeat,e);walkerG.position.y+=sn*0.7;
      walkerG.rotation.y=lerp(I.walkYaw,P.yaw,e);
      walkParts.legL.rotation.x=0.9*sn;walkParts.legR.rotation.x=-0.4*sn;walkParts.armL.rotation.x=-1.0*sn;
    }
  }
  if(t>=I.seat&&!I.seated){
    I.seated=true;walkerG.visible=false;riderG.visible=true;P.kick=1;P.shake=Math.max(P.shake,0.25);
    SFX.board();emitSpray(P.x,0.2,P.z,10,3,3);
  }
  if(t<I.push){
    vBow.set(0,0.4,-2.7);canoeG.localToWorld(vBow);
    const zs=I.zc-2.4,ds=0.9;
    stakeM.position.set(riverC(zs)+s*(riverW(zs)/2+ds),groundY(s,zs,ds)+0.3,zs);
    const p=ropeGeo.attributes.position.array;
    for(let k=0;k<ROPE_N;k++){
      const f=k/(ROPE_N-1);
      p[k*3]=lerp(vBow.x,stakeM.position.x,f);
      p[k*3+1]=lerp(vBow.y,stakeM.position.y+0.4,f)-0.35*4*f*(1-f);
      p[k*3+2]=lerp(vBow.z,stakeM.position.z,f);
    }
    ropeGeo.attributes.position.needsUpdate=true;
  }else ropeL.visible=false;
  if(!I.c0&&t>0.9){I.c0=true;toast('Sua filha está com febre. O remédio só chega pelo rio, até a vila.');}
  if(!I.c1&&t>4.6){I.c1=true;toast('A tempestade fechou a estrada. Só resta o rio.');}
  if(!I.c2&&t>8.6){I.c2=true;toast('Um jacaré faminto vigia a água… Não olhe para trás.');}
  if(t>=I.end)finishIntro();
}
/* câmera cinematográfica: plano da margem -> embarque -> câmera normal */
function introCamera(pos,look){
  const t=G.ti,wAB=smooth((t-3.5)/3.0),wN=smooth((t-8.0)/2.5);
  vA.set(P.x-8+t*0.3,1.7+P.waveY,P.z+1.2);
  vB.set(P.x-1.8,2.7+P.waveY*0.5,P.z+7.2);
  lA.copy(walkerG.visible?walkerG.position:canoeG.position);lA.y+=1.2;
  lB.set(P.x,0.9,P.z-0.5);
  vA.lerp(vB,wAB);lA.lerp(lB,wAB);
  pos.lerpVectors(vA,pos,wN);look.lerpVectors(lA,look,wN);
}

/* ============================================================
   VILA BOA ESPERANÇA (destino final)
   ============================================================ */
const VIL={g:new THREE.Group(),light:new THREE.PointLight(0xffb060,0,40,2),fig:makeFigure(0xc2453a,'villager'),pier:null,sign:null,endX:0,zp:0};
VIL.g.visible=false;scene.add(VIL.g);scene.add(VIL.light);
const vWood=new THREE.MeshLambertMaterial({color:0xffffff}),vGlow=new THREE.MeshBasicMaterial({color:0xffc860});
function vinst(geo,mat,n){const m=new THREE.InstancedMesh(geo,mat,n);m.frustumCulled=false;m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);VIL.g.add(m);return m;}
const stiltGeo=new THREE.CylinderGeometry(0.12,0.14,1,6);stiltGeo.translate(0,0.5,0);
const roofGeo=new THREE.ConeGeometry(2.9,1.3,4);roofGeo.rotateY(Math.PI/4);
const VH={stilt:vinst(stiltGeo,vWood,28),floor:vinst(new THREE.BoxGeometry(3.8,0.15,3.4),vWood,7),wall:vinst(new THREE.BoxGeometry(3.4,2.0,3.0),vWood,7),
  roof:vinst(roofGeo,vWood,7),win:vinst(new THREE.BoxGeometry(0.05,0.55,0.7),vGlow,7),post:vinst(new THREE.CylinderGeometry(0.1,0.12,1.6,6),vWood,8),lamp:vinst(new THREE.SphereGeometry(0.16,8,6),vGlow,6)};
VIL.pier=new THREE.Mesh(new THREE.BoxGeometry(12,0.14,2.4),new THREE.MeshLambertMaterial({color:0x6b5035}));VIL.g.add(VIL.pier);
(function(){
  const cv=document.createElement('canvas');cv.width=512;cv.height=128;const cx=cv.getContext('2d');
  cx.fillStyle='#4a3220';cx.fillRect(0,0,512,128);cx.strokeStyle='#2b1c10';cx.lineWidth=8;cx.strokeRect(4,4,504,120);
  cx.fillStyle='#f0d27a';cx.font='bold 38px Georgia,serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText('VILA BOA ESPERANÇA',256,66);
  VIL.sign=new THREE.Mesh(new THREE.PlaneGeometry(3.6,0.9),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),side:THREE.DoubleSide}));VIL.g.add(VIL.sign);
  VIL.signPosts=[0,1].map(()=>{const p=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.08,2.8,6),new THREE.MeshLambertMaterial({color:0x3b2a1a}));VIL.g.add(p);return p;});
  VIL.g.add(VIL.fig.g);
})();
function vput(mesh,i,x,y,z,sy,h,sat,l){
  dummy.position.set(x,y,z);dummy.rotation.set(0,0,0);dummy.scale.set(1,sy,1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
  if(h!==undefined){colTmp.setHSL(h,sat,l);mesh.setColorAt(i,colTmp);}
}
function placeVillage(){
  const ze=zEnd();
  const H=[[1,18,7],[1,5,12],[1,-6,9],[1,-27,8],[-1,12,9],[-1,-4,12],[-1,-20,7]]; // [margem, dz, distância]
  let si=0;
  H.forEach((h,i)=>{
    const side=h[0],z=ze+h[1],x=riverC(z)+side*(riverW(z)/2+h[2]),gy=groundY(side,z,h[2]);
    for(const sx of[-1.5,1.5])for(const sz of[-1.3,1.3])vput(VH.stilt,si++,x+sx,gy-0.3,z+sz,2.1,0.07,0.25,0.12);
    vput(VH.floor,i,x,gy+1.8,z,1,0.08,0.3,0.2);
    vput(VH.wall,i,x,gy+2.9,z,1,0.09+hash1(i*3.1)*0.04,0.35,0.26+hash1(i)*0.08);
    vput(VH.roof,i,x,gy+4.55,z,1,0.12,0.5,0.22);
    vput(VH.win,i,x-side*1.72,gy+3.0,z,1);
  });
  const zp=ze-14,cp=riverC(zp),hwp=riverW(zp)/2;
  VIL.zp=zp;VIL.endX=cp+hwp-8.5;
  VIL.pier.position.set(cp+hwp-3,0.65,zp);
  let pi=0,li=0;
  for(const dx of[-8.6,-5.5,-2.5,0.4])for(const sz of[-1.1,1.1])vput(VH.post,pi++,cp+hwp+dx,0.2,zp+sz,1,0.07,0.25,0.12);
  for(const dx of[-8.6,-4.5,0.4])for(const sz of[-1.1,1.1])vput(VH.lamp,li++,cp+hwp+dx,1.25,zp+sz,1);
  const zs=ze+8,xs=riverC(zs)+riverW(zs)/2+3.2;
  VIL.sign.position.set(xs,2.6,zs);
  VIL.signPosts[0].position.set(xs-1.7,1.4,zs);VIL.signPosts[1].position.set(xs+1.7,1.4,zs);
  VIL.fig.g.position.set(VIL.endX,0.72,zp);VIL.fig.g.rotation.y=Math.PI/2;
  VIL.light.position.set(VIL.endX,2.4,zp);
  for(const m of Object.values(VH)){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
}
function updateVillage(){
  VIL.g.visible=G.state!=='menu';
  VIL.light.intensity=G.state==='menu'?0:smooth((env.p-0.85)/0.12)*1.8;
  VIL.fig.parts.armR.rotation.z=2.6+Math.sin(T*7)*0.35;
}
placeVillage();
function setRunOrigin(){
  RUN_Z0=P.z;bankBase=null;
  if(worldDirty){rebuildForest();worldDirty=false;}
  placeVillage();
}

/* ============================================================
   LIGHTNING
   ============================================================ */
const L={next:5,ft:99};
const bolt=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,1,0)]),new THREE.LineBasicMaterial({color:0xdfe9ff,fog:false,transparent:true}));
bolt.visible=false;bolt.frustumCulled=false;scene.add(bolt);
const flashLevel=ft=>{if(ft<0||ft>1.4)return 0;let v=Math.exp(-ft*10);if(ft>0.16)v=Math.max(v,0.8*Math.exp(-(ft-0.16)*7));return v;};
function strike(){
  L.ft=0;
  const pts=[];let x=P.x+rand(-140,140),y=170,z=P.z-rand(120,260);
  for(let i=0;i<=16;i++){pts.push(new THREE.Vector3(x,y,z));y-=168/16;x+=rand(-9,9);z+=rand(-5,5);}
  bolt.geometry.setFromPoints(pts);
  SFX.thunder(rand(0.5,2.4));
}
function updateLightning(dt){
  const st=G.state;
  if(st==='menu'||st==='intro'||(st==='playing'&&G.t>20&&env.p<0.68)||(st==='lost'&&env.p<0.68)){
    L.next-=dt;
    if(L.next<=0){strike();L.next=(st==='menu'||st==='intro')?rand(9,15):lerp(14,8,smooth(G.t/80))*rand(0.8,1.25);}
  }
  L.ft+=dt;env.flash=flashLevel(L.ft);
  bolt.visible=L.ft<0.3;bolt.material.opacity=env.flash;
}

/* ============================================================
   AUDIO (Web Audio procedural)
   ============================================================ */
const SFX={
  ctx:null,master:null,on:true,g:{},nb:{},chirpT:4,frogT:6,
  init(){
    if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume();return;}
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
    const c=this.ctx=new AC();
    const comp=c.createDynamicsCompressor();comp.threshold.value=-18;comp.ratio.value=6;
    this.master=c.createGain();this.master.gain.value=this.on?0.9:0;this.master.connect(comp);comp.connect(c.destination);
    const sr=c.sampleRate,len=sr*3,w=c.createBuffer(1,len,sr),b=c.createBuffer(1,len,sr);
    const wd=w.getChannelData(0),bd=b.getChannelData(0);let last=0;
    for(let i=0;i<len;i++){const r=Math.random()*2-1;wd[i]=r;last=(last+0.02*r)/1.02;bd[i]=last*3.5;}
    this.nb={white:w,brown:b};
    const loop=buf=>{const s=c.createBufferSource();s.buffer=buf;s.loop=true;s.start(0,Math.random()*2);return s;};
    const filt=(type,f,q)=>{const n=c.createBiquadFilter();n.type=type;n.frequency.value=f;if(q!==undefined)n.Q.value=q;return n;};
    const gain=v=>{const g=c.createGain();g.gain.value=v;return g;};
    const lfo=(f,amt,target)=>{const o=c.createOscillator(),g=gain(amt);o.frequency.value=f;o.connect(g);g.connect(target);o.start();};
    const G_=this.g;
    G_.rain=gain(0.05);loop(w).connect(filt('bandpass',5200,0.5)).connect(G_.rain);G_.rain.connect(this.master);
    G_.rainLow=gain(0.05);loop(w).connect(filt('lowpass',1400)).connect(G_.rainLow);G_.rainLow.connect(this.master);
    G_.water=gain(0.12);loop(b).connect(filt('lowpass',600)).connect(G_.water);G_.water.connect(this.master);lfo(0.4,0.04,G_.water.gain);
    G_.rush=gain(0.01);loop(w).connect(filt('bandpass',1800,0.6)).connect(G_.rush);G_.rush.connect(this.master);
    const wf=filt('bandpass',350,1.0);G_.wind=gain(0.05);loop(b).connect(wf).connect(G_.wind);G_.wind.connect(this.master);lfo(0.11,120,wf.frequency);
    const inf=filt('bandpass',6400,9);G_.ins=gain(0.03);loop(w).connect(inf).connect(G_.ins);G_.ins.connect(this.master);lfo(22,0.012,G_.ins.gain);
    G_.danger=gain(0);const dl=filt('lowpass',240);
    [48,51.5].forEach(f=>{const o=c.createOscillator();o.type='sawtooth';o.frequency.value=f;o.connect(dl);o.start();});
    dl.connect(G_.danger);G_.danger.connect(this.master);
  },
  suspend(){if(this.ctx)this.ctx.suspend();},
  resume(){if(this.ctx)this.ctx.resume();},
  toggle(){this.on=!this.on;if(this.master)this.master.gain.setTargetAtTime(this.on?0.9:0,this.ctx.currentTime,0.05);return this.on;},
  set(p,v){this.g[p].gain.setTargetAtTime(v,this.ctx.currentTime,0.3);},
  update(rain,sp,danger,dt,bz){
    if(!this.ctx)return;
    this.set('rain',0.03+0.17*rain);this.set('rainLow',0.04+0.12*rain);
    this.set('water',0.1+0.16*sp);this.set('rush',0.005+0.08*sp*sp);
    this.set('wind',0.03+0.1*rain+0.06*sp+0.12*(bz||0));this.set('ins',0.015+0.02*(1-rain));
    this.set('danger',0.17*danger);
    this.chirpT-=dt;if(this.chirpT<=0){this.chirpT=rand(3,8);if(rain<0.7&&Math.random()<0.7)this.chirp();}
    this.frogT-=dt;if(this.frogT<=0){this.frogT=rand(4,9);this.frog();}
  },
  burst(o){
    if(!this.ctx)return;const c=this.ctx,t0=c.currentTime+(o.delay||0),dur=o.dur||0.4;
    const s=c.createBufferSource();s.buffer=this.nb[o.buf||'white'];
    const f=c.createBiquadFilter();f.type=o.type||'lowpass';f.Q.value=o.q||0.7;
    f.frequency.setValueAtTime(o.f0||800,t0);f.frequency.exponentialRampToValueAtTime(Math.max(20,o.f1||200),t0+dur);
    const g=c.createGain();g.gain.setValueAtTime(0.0001,t0);g.gain.linearRampToValueAtTime(o.vol||0.3,t0+(o.attack||0.01));g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    s.connect(f);f.connect(g);g.connect(this.master);s.start(t0,Math.random()*2);s.stop(t0+dur+0.05);
  },
  tone(type,f0,f1,dur,vol,delay){
    if(!this.ctx)return;const c=this.ctx,t0=c.currentTime+(delay||0);
    const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(f0,t0);o.frequency.exponentialRampToValueAtTime(f1,t0+dur);
    g.gain.setValueAtTime(0.0001,t0);g.gain.linearRampToValueAtTime(vol,t0+0.01);g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g);g.connect(this.master);o.start(t0);o.stop(t0+dur+0.05);
  },
  banzeiro(){this.burst({type:'bandpass',f0:300,f1:900,dur:2.6,vol:0.5,q:0.6,buf:'brown',attack:1.2});this.tone('sawtooth',55,90,2.4,0.12);},
  hiss(){this.burst({type:'highpass',f0:3500,f1:2200,dur:0.7,vol:0.28,attack:0.05});},
  scrape(){this.burst({type:'bandpass',f0:900,f1:300,dur:0.6,vol:0.3,q:1});},
  leaf(){this.burst({type:'bandpass',f0:2500,f1:1200,dur:0.35,vol:0.12});},
  sting(){this.tone('sawtooth',110,70,0.9,0.18);this.tone('sine',55,45,1.2,0.3);},
  arrive(){[523,659,784,1047].forEach((f,i)=>this.tone('sine',f,f*1.002,1.4,0.16,i*0.28));},
  step(){this.burst({f0:700,f1:180,dur:0.14,vol:0.11});},
  board(){this.tone('sine',130,60,0.25,0.35);this.splash(0.4);},
  paddle(v){this.burst({f0:1300,f1:300,dur:0.35,vol:0.05+0.1*v});},
  splash(v){this.burst({type:'bandpass',f0:2600,f1:600,dur:0.55,vol:0.35*v,q:0.8});this.burst({f0:500,f1:120,dur:0.5,vol:0.4*v,buf:'brown'});},
  thud(){this.tone('sine',110,40,0.3,0.6);this.burst({f0:900,f1:150,dur:0.35,vol:0.5});this.splash(0.6);},
  crunch(){this.tone('sine',90,30,0.7,0.8);this.burst({f0:3000,f1:200,dur:0.7,vol:0.7});this.splash(1);this.growl();},
  thunder(delay){
    this.burst({type:'highpass',f0:3500,f1:600,dur:0.3,vol:0.35,delay});
    this.burst({f0:420,f1:55,dur:4.6,vol:1.0,attack:0.2,buf:'brown',delay:delay+0.05});
    this.burst({f0:300,f1:50,dur:3.2,vol:0.6,attack:0.3,buf:'brown',delay:delay+0.9});
  },
  alert(){this.tone('square',880,860,0.14,0.1);this.tone('square',620,600,0.16,0.1,0.17);},
  beat(k){this.tone('sine',75,38,0.16,0.55*k);this.tone('sine',70,36,0.16,0.4*k,0.19);},
  growl(){this.tone('sawtooth',70,45,0.9,0.22);this.burst({type:'bandpass',f0:420,f1:160,dur:0.9,vol:0.25,q:1.5});},
  chirp(){for(let i=0;i<3;i++)this.tone('sine',rand(2300,2800),rand(3500,4300),0.09,0.04,i*0.13);},
  frog(){for(let i=0;i<3;i++)this.tone('square',rand(160,220),rand(130,170),0.07,0.025,i*0.11);}
};

/* ============================================================
   CONTROLS
   ============================================================ */
const KEYMAP={ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'up',KeyW:'up',ArrowDown:'down',KeyS:'down'};
addEventListener('keydown',e=>{
  const k=KEYMAP[e.code];
  if(k){kb[k]=true;e.preventDefault();return;}
  if(G.state==='intro'&&(e.code==='Escape'||e.code==='Space'||e.code==='Enter')){startGame();e.preventDefault();}
  else if(e.code==='Escape'||e.code==='KeyP'){togglePause();e.preventDefault();}
  else if(e.code==='KeyR'&&G.state!=='menu'){startGame();}
  else if(e.code==='KeyM'&&G.state!=='menu'){toMenu();}
});
addEventListener('keyup',e=>{const k=KEYMAP[e.code];if(k)kb[k]=false;});
addEventListener('blur',()=>{for(const k in kb)kb[k]=false;if(G.state==='playing')togglePause();});
document.querySelectorAll('#touch [data-k]').forEach(b=>{
  const k=b.dataset.k;
  const on=e=>{e.preventDefault();tc[k]=true;b.classList.add('d');};
  const off=e=>{e.preventDefault();tc[k]=false;b.classList.remove('d');};
  b.addEventListener('pointerdown',on);['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,off));
});

/* ============================================================
   UI
   ============================================================ */
const banEl=$('banner');
function showBanner(t,sub){$('banTitle').textContent=t;$('banSub').textContent=sub||'';banEl.classList.remove('on');void banEl.offsetWidth;banEl.classList.add('on');}
const hudEl=$('hud'),barsEl=$('bars'),dangerEl=$('danger'),toastEl=$('toast'),mirrorEl=$('mirror'),vignEl=$('vignette');
const show=el=>el.classList.remove('hidden'),hide=el=>el.classList.add('hidden');
let toastTimer=0,hudTimer=0,mirrorRect={x:0,y:0,w:10,h:10};
const bar=(v,n=10)=>{const k=Math.round(clamp(v,0,1)*n);return '█'.repeat(k)+'░'.repeat(n-k);};
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.remove('on'),3200);}
function updateHUD(dt){
  hudTimer-=dt;if(hudTimer>0)return;hudTimer=0.1;
  const near=env.danger>0.15,tired=P.exhausted,pct=Math.round(env.p*100);
  $('hudPhase').textContent='FASE '+(G.phase+1)+'/3 · '+COURSE.names[G.phase];
  barsEl.innerHTML='Velocidade: '+bar(P.s/CFG.vMax)+'\n'+
    'Distância do jacaré: <span class="'+(near?'warn':'')+'">'+bar(C.D/100)+'</span>\n'+
    'Fôlego: <span class="'+(tired?'tired':'')+'">'+bar(P.stamina)+(tired?' ⚠':'')+'</span>\n'+
    'Percurso: '+bar(env.p)+' '+pct+'%';
  dangerEl.classList.toggle('hidden',!(near&&G.state==='playing'));
  mirrorEl.classList.toggle('alert',near);
}
function measureMirror(){
  const r=mirrorEl.getBoundingClientRect();
  mirrorRect={x:r.left,y:r.top,w:r.width,h:r.height};
  if(r.width>0)rearCam.aspect=r.width/r.height,rearCam.updateProjectionMatrix();
}
function setUI(){
  const st=G.state,play=st==='playing'||st==='paused'||st==='lost'||st==='won';
  play?show(hudEl):hide(hudEl);
  play?show(mirrorEl):hide(mirrorEl);
  (st==='playing'||st==='paused')?show($('btnPause')):hide($('btnPause'));
  st==='menu'?show($('menu')):hide($('menu'));
  st==='paused'?show($('pause')):hide($('pause'));
  if(st!=='lost'&&st!=='won')hide($('end'));
  $('touch').classList.toggle('on',st==='playing'||st==='paused');
  if(!play||st==='paused')hide(dangerEl);
  if(play)measureMirror();
  st==='menu'?hide($('btnMenu')):show($('btnMenu'));
  ['cineT','cineB','btnSkip'].forEach(id=>st==='intro'?show($(id)):hide($(id)));
}
function endScreen(win){
  const e=$('end');e.className='overlay '+(win?'win':'lose');
  $('endTitle').textContent=win?'VOCÊ ESCAPOU!':'O JACARÉ TE PEGOU!';
  $('endSub').textContent=win
    ?'Você chegou à Vila Boa Esperança em '+fmt(G.t)+'. O remédio chegou a tempo — a Aninha vai ficar bem.'
    :'Você caiu na fase '+(G.phase+1)+' ('+COURSE.names[G.phase]+'), a '+Math.round(G.endP*100)+'% do caminho, após '+fmt(G.t)+'. O remédio não chegou… tente de novo.';
  show(e);
}
function togglePause(){
  if(G.state==='playing'){G.state='paused';SFX.suspend();setUI();}
  else if(G.state==='paused'){G.state='playing';SFX.resume();setUI();}
}
$('btnStart').onclick=()=>{SFX.init();beginIntro();};
$('btnSkip').onclick=()=>startGame();
$('btnHow').onclick=()=>$('how').classList.toggle('hidden');
$('btnResume').onclick=togglePause;
$('btnRestart1').onclick=()=>{SFX.resume();startGame();};
$('btnRestart2').onclick=()=>startGame();
$('btnToMenu1').onclick=toMenu;
$('btnToMenu2').onclick=toMenu;
$('btnMenu').onclick=toMenu;
$('btnPause').onclick=togglePause;
$('btnSound').onclick=()=>{SFX.init();$('btnSound').textContent=SFX.toggle()?'🔊 Som ON':'🔇 Som OFF';};
function onResize(){
  renderer.setSize(innerWidth,innerHeight);
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  dropC.width=innerWidth;dropC.height=innerHeight;
  measureMirror();
}
addEventListener('resize',onResize);

/* ============================================================
   GAME STATE (fluxo)
   ============================================================ */
const EVENTS=[[2,'A chuva está engrossando…'],[9.5,'Um jacaré-açu faminto segue a canoa!']];
const fadeEl=$('fade');
/* placar da última sobrevivência (localStorage, com reserva em memória) */
const LS_KEY='fugaAmazonas.ultimo';
let lastScore=null;
try{lastScore=JSON.parse(localStorage.getItem(LS_KEY));}catch(e){}
function saveScore(sec,escaped,p){
  lastScore={s:Math.floor(sec),w:!!escaped,p:p};
  try{localStorage.setItem(LS_KEY,JSON.stringify(lastScore));}catch(e){}
}
function renderScore(){
  const box=$('lastScore'),has=lastScore&&typeof lastScore.s==='number';
  box.classList.toggle('win',!!(has&&lastScore.w));box.classList.toggle('lose',!!(has&&!lastScore.w));
  $('scoreVal').textContent=has?fmt(lastScore.s):'--:--';
  $('scoreNote').textContent=!has?'Ainda sem registro':(lastScore.w?'Você chegou à vila! Percurso completo':'O jacaré te pegou'+(typeof lastScore.p==='number'?' a '+Math.round(lastScore.p*100)+'% do caminho':''));
}
function toMenu(){
  resetRun();endIntroVisuals();
  G.state='menu';P.o=0;P.vo=0;P.s=14;camX=riverC(P.z);
  setRunOrigin();
  resetObstacles(false);renderScore();setUI();
}
function resetRun(){
  SFX.resume();
  G.t=0;G.endDelay=0;G.evt=0;G.phase=0;G.near=false;G.endP=0;
  P.stamina=1;P.exhausted=false;P.hitCD=0;P.shake=0;P.kick=0;
  Object.assign(C,{D:CFG.startGap,o:0,surf:0,surfTarget:0,emerged:false,diving:false,diveT:0,nextDive:rand(14,20),nextSurge:rand(10,15),surgeT:0,beatT:0});
  env.danger=0;L.ft=99;
  resetSnake();resetBanzeiro();
  vignEl.style.opacity=0;
}
function onPhase(ph){
  showBanner('FASE '+(ph+1)+' — '+COURSE.names[ph],COURSE.subs[ph]);SFX.sting();
  if(ph>=1){BZ.next=6;SN.next=rand(10,14);}
}
function endIntroVisuals(){
  walkerG.visible=false;riderG.visible=true;ropeL.visible=false;stakeM.visible=false;
  fadeEl.style.transition='none';fadeEl.style.opacity=0;
}
function startGame(){
  resetRun();endIntroVisuals();
  G.state='playing';
  P.o=0;P.vo=0;P.s=13;camX=riverC(P.z);
  setRunOrigin();
  L.next=3;
  resetObstacles(true);
  setUI();
  showBanner('FASE 1 — '+COURSE.names[0],COURSE.subs[0]);
}
function beginIntro(){
  resetRun();
  G.state='intro';G.ti=0;
  P.s=0;P.vo=0;
  setRunOrigin();
  Object.assign(I,{zc:P.z,hw:riverW(P.z)/2,wph:0,c0:false,c1:false,c2:false,seated:false});
  P.o=I.hw-2.65;P.x=riverC(P.z)+P.o;
  camX=P.x;camY=3.1;camYaw=0;camera.fov=40;
  clearCorridor(P.z,I.side);
  resetObstacles(false);
  walkerG.visible=true;riderG.visible=false;ropeL.visible=true;stakeM.visible=true;
  L.next=2.5;
  fadeEl.style.transition='none';fadeEl.style.opacity=1;void fadeEl.offsetWidth;
  fadeEl.style.transition='opacity 1.8s ease';fadeEl.style.opacity=0;
  setUI();
}
function finishIntro(){
  G.state='playing';G.t=0;G.evt=0;P.hitCD=0;L.next=3;
  endIntroVisuals();resetObstacles(true);setUI();
  showBanner('FASE 1 — '+COURSE.names[0],COURSE.subs[0]);
}
function win(){
  saveScore(G.t,true,1);G.endP=1;G.state='won';G.endDelay=3.5;setUI();
  toast('Você chegou à vila!');SFX.arrive();
}
function lose(){
  G.endP=env.p;saveScore(G.t,false,env.p);G.state='lost';G.endDelay=1.8;P.shake=1.4;
  SFX.crunch();emitSpray(P.x,0.3,P.z+2,40,6,8);vignEl.style.opacity=1;setUI();
}

/* ============================================================
   UPDATE
   ============================================================ */
function updatePlayer(dt){
  const st=G.state;
  const moored=(st==='intro'&&G.ti<I.push);
  let steer=0,up=false,down=false;
  if(st==='playing'){steer=(inp.right?1:0)-(inp.left?1:0);up=inp.up;down=inp.down;}
  else if(st==='menu'){steer=clamp(-P.o*0.12-P.vo*0.25,-1,1);}
  else if(st==='won'){steer=clamp((riverW(P.z)/2-12-P.o)*0.12-P.vo*0.25,-1,1);}
  else if(st==='intro'&&!moored){steer=clamp((I.hw*0.6-P.o)*0.15-P.vo*0.12,-1,1);}
  const cruise=st==='menu'?14:12+5*smooth(G.t/30);
  const cap=P.exhausted?CFG.vTired:CFG.vMax;
  let target=cruise;if(up)target=cap;else if(down)target=CFG.vMin;
  target=Math.min(target,cap*(1-0.2*env.bz));if(st==='lost'||st==='won')target=0;
  const acc=target>P.s?12:(st==='lost'?14:18);
  P.s+=clamp(target-P.s,-acc*dt,acc*dt);
  if(moored)P.s=0;
  if(st==='playing'){
    if(up&&!P.exhausted)P.stamina-=CFG.drain*dt;
    else P.stamina+=(up?0.03:(down?0.18:CFG.regen))*dt;
    P.stamina=clamp(P.stamina,0,1);
    if(P.stamina<=0.001&&!P.exhausted){P.exhausted=true;toast('Sem fôlego! Solte o acelerador para recuperar.');}
    if(P.exhausted&&P.stamina>=CFG.resumeAt)P.exhausted=false;
  }
  // lateral: controle + deriva centrífuga nas curvas
  const drift=-riverDDC(P.z)*P.s*P.s*0.8*(st==='lost'?0.3:1)+env.bz*15*Math.sin(T*1.7+BZ.ph);
  P.vo+=(steer*22+drift-P.vo*2.4)*dt;
  if(moored)P.vo=0;
  P.o+=P.vo*dt;
  const lim=riverW(P.z)/2-2.6;
  if(Math.abs(P.o)>lim){
    P.o=Math.sign(P.o)*lim;P.vo*=-0.35;
    if(st==='playing'&&P.hitCD<=0){P.s*=0.8;P.shake=Math.max(P.shake,0.6);P.hitCD=0.6;SFX.thud();emitSpray(P.x,0.2,P.z,14,3,4);}
  }
  P.hitCD-=dt;
  P.z-=P.s*dt;P.x=riverC(P.z)+P.o;
  P.yaw=damp(P.yaw,Math.atan2(riverDC(P.z)*P.s-P.vo,Math.max(P.s,5)),4,dt);
  // balanço nas ondas
  const amp=waveAmp();
  P.waveY=waveH(P.x,P.z,T,amp);
  const sp=(waveH(P.x,P.z-2.5,T,amp)-waveH(P.x,P.z+2.5,T,amp))/5;
  const sr=(waveH(P.x+0.7,P.z,T,amp)-waveH(P.x-0.7,P.z,T,amp))/1.4;
  P.roll=damp(P.roll,-P.vo*0.02+Math.atan(sr)*1.5+(st==='lost'?Math.sin(T*9)*0.25:0)+Math.sin(T*8)*0.1*P.kick+env.bz*0.2*Math.sin(T*2.4),6,dt);
  P.kick*=Math.exp(-2.2*dt);
  P.pitch=damp(P.pitch,Math.atan(sp)*1.5+(P.s/CFG.vMax)*0.05,6,dt);
  canoeG.position.set(P.x,P.waveY*0.9+0.08-0.12*P.kick,P.z);
  canoeG.rotation.set(P.pitch,P.yaw,P.roll);
  // remada
  const oldPh=P.ph;P.ph+=dt*(2.4+P.s*0.1+(up?2:0));
  const pk=clamp(P.s/5,0,1);
  paddleG.rotation.x=Math.sin(P.ph)*0.8*pk;paddleG.rotation.z=0.45*Math.sin(P.ph*0.5)*pk;
  if(st!=='lost'&&pk>0.5&&riderG.visible&&Math.floor(P.ph/Math.PI)!==Math.floor(oldPh/Math.PI))SFX.paddle(P.s/CFG.vMax);
  // espuma na proa
  const n=Math.floor(P.s*dt*1.2*(1+3*env.bz)+Math.random());
  if(n>0){const bx=Math.sin(P.yaw)*0,s2=Math.random()<0.5?-1:1;emitSpray(P.x+s2*0.5-Math.sin(P.yaw)*2.4+bx,0.1,P.z-Math.cos(P.yaw)*2.4,n,2.2+P.s*0.05,2);}
}
function emergeFx(big){SFX.splash(big?0.9:0.6);SFX.growl();emitSpray(C.x,0.2,P.z+C.D,big?30:16,5,6);}
function updateCroc(dt){
  const st=G.state;let danger=0;
  if(st==='playing'){
    const t=G.t;
    if(t>=CFG.appearT&&!C.emerged){C.emerged=true;emergeFx(true);}
    if(C.emerged){
      if(!C.diving){C.nextDive-=dt;if(C.nextDive<=0){C.diving=true;C.diveT=2.2;}}
      else{C.diveT-=dt;if(C.diveT<=0){C.diving=false;C.nextDive=rand(12,20);C.surgeT=rand(1.6,2.4);emergeFx(false);}}
      let vC=13+7*smooth(env.p)+(G.phase>=2?1:0);
      if(C.surgeT>0){vC+=6;C.surgeT-=dt;}
      else{C.nextSurge-=dt;if(C.nextSurge<=0){C.surgeT=rand(1.8,3);C.nextSurge=rand(11,18);SFX.growl();}}
      if(C.diving)vC*=0.7;
      if(C.D>70)vC+=(C.D-70)*0.07;
      C.D=clamp(C.D+(P.s-vC)*dt,0,CFG.maxGap);C.vC=vC;
      C.surfTarget=C.diving?0:1;
      danger=clamp((CFG.dangerDist-C.D)/(CFG.dangerDist-CFG.catchDist),0,1);
      if(C.D<=CFG.catchDist){lose();danger=1;}
    }else{C.surfTarget=0;C.vC=P.s;}
  }else if(st==='lost'){C.D=damp(C.D,2.6,5,dt);C.surfTarget=1;danger=1;}
  else if(st==='won'){C.surfTarget=0;C.D+=dt*8;}
  else{C.surfTarget=0;}
  // alerta sonoro ao entrar na zona de perigo + batimentos
  if(danger>0.2&&env.danger<=0.2&&st==='playing')SFX.alert();
  if(st==='playing'&&danger>0.05){C.beatT-=dt;if(C.beatT<=0){SFX.beat(0.4+danger*0.6);C.beatT=lerp(1.1,0.38,danger);}}
  env.danger=danger;
  // posição e animação
  C.surf=damp(C.surf,C.surfTarget,2.5,dt);
  C.z=P.z+C.D+CROC_TIP;
  const follow=1.2+5*danger;
  C.prevO=C.o;
  C.o=damp(C.o,P.o+4*Math.sin(T*0.6)*(1-danger),follow,dt);
  const lim=riverW(C.z)/2-3;C.o=clamp(C.o,-lim,lim);
  C.x=riverC(C.z)+C.o;
  C.yaw=damp(C.yaw,clamp(Math.atan2(riverDC(C.z)*P.s-(C.o-C.prevO)/Math.max(dt,0.001),Math.max(P.s,5)),-0.6,0.6),3,dt);
  const vis=C.surf>0.02;crocG.visible=vis;
  const amp=waveAmp();
  crocG.position.set(C.x,lerp(-1.9,-0.38,C.surf)+waveH(C.x,C.z,T,amp)*0.7,C.z);
  crocG.rotation.set(Math.sin(T*1.3)*0.02,C.yaw,Math.sin(T*1.7)*0.05);
  if(vis){
    const vN=clamp(C.vC/26,0.5,1.2);
    for(let i=0;i<crocTail.length;i++)crocTail[i].rotation.y=Math.sin(T*3.2*vN-i*0.75)*(0.16+0.05*i);
    const open=(st==='lost'?0.9:0.06+0.5*danger*danger+(C.surgeT>0?0.18:0))+Math.sin(T*2)*0.02;
    jawG.rotation.x=-open;
    if(C.surf>0.6&&Math.random()<dt*10)emitSpray(C.x,0.1,C.z-CROC_TIP,1,1.5,1.5);
  }
}
function updateCamera(dt){
  camYaw=damp(camYaw,P.yaw,2.2,dt);
  const back=8.4+(P.s-14)*0.05,sy=Math.sin(camYaw),cy=Math.cos(camYaw);
  camX=damp(camX,P.x+sy*back,5,dt);camY=damp(camY,3.1+P.waveY*0.6,4,dt);
  P.shake=Math.max(P.shake*Math.exp(-4*dt),env.danger*0.45,env.bz*0.35);
  const sh=P.shake*0.28;
  camNP.set(camX+Math.sin(T*53)*sh*0.7,camY+Math.sin(T*61+1)*sh*0.5,P.z+cy*back);
  camNL.set(P.x-sy*10,0.9,P.z-cy*10);
  if(G.state==='intro')introCamera(camNP,camNL);
  camera.position.copy(camNP);camera.lookAt(camNL);
  camera.rotateZ(P.roll*0.5+Math.sin(T*47+2)*P.shake*0.02);
  const fovT=G.state==='intro'?lerp(40,60,smooth((G.ti-3.0)/4.5)):60+13*Math.pow(P.s/CFG.vMax,1.5);camera.fov=damp(camera.fov,fovT,G.state==='intro'?8:3,dt);camera.updateProjectionMatrix();
  // câmera traseira (quadro ATRÁS)
  const bs=Math.sin(P.yaw),bc=Math.cos(P.yaw);
  rearCam.position.set(P.x+bs*3.3,1.7+P.waveY,P.z+bc*3.3);
  rearCam.lookAt(P.x+bs*30,0.9,P.z+bc*30);
}
function updateWorldFx(dt){
  const rain=env.rain,f=env.flash;
  const w=env.warm;
  scene.fog.density=lerp(0.0095,0.0135,rain)+0.0015*w;
  fogBase.copy(fogCool).lerp(fogWarm,w);
  fogTmp.copy(fogBase).lerp(fogFlash,f*0.7);scene.fog.color.copy(fogTmp);renderer.setClearColor(fogTmp);
  skyMat.uniforms.uHorizon.value.copy(fogTmp);skyMat.uniforms.uTime.value=T;skyMat.uniforms.uFlash.value=f;
  skyMat.uniforms.uZenith.value.copy(zenCool).lerp(zenWarm,w);
  hemi.color.copy(hemiCool).lerp(hemiWarm,w);sun.color.copy(sunCool).lerp(sunWarm,w);
  hemi.intensity=0.62+0.2*w+2.2*f;sun.intensity=0.55+0.4*w+1.6*f;
  const u=waterMat.uniforms;
  u.uTime.value=T;u.uAmp.value=waveAmp();u.uRain.value=rain;u.uFlash.value=f;u.uSky.value.copy(fogTmp);u.uSpeed.value=P.s;
  u.uCanoe.value.set(P.x,P.z);u.uCroc.value.set(C.x,C.z-CROC_TIP);u.uCrocVis.value=C.surf;
  water.position.set(P.x,0,P.z);
  const r=rainMat.uniforms;r.uTime.value=T;r.uInt.value=0.18+0.82*rain;r.uWind.value=4+5*rain;
  sky.position.copy(camera.position);
  updateSpray(dt);
}
function update(dt){
  T+=dt;
  const st=G.state;
  if(st==='playing')G.t+=dt;
  if(st==='intro')G.ti+=dt;
  const t=G.t;
  const run=st==='playing'||st==='won'||st==='lost'||st==='paused';
  if(st==='menu')RUN_Z0=P.z;
  env.p=run?progressAt(P.z):0;
  if(run&&env.p>0.5)worldDirty=true;
  const p=env.p;
  let rainT;
  if(st==='menu')rainT=0.45;else if(st==='intro')rainT=0.3;else if(st==='won')rainT=0.05;
  else rainT=p<1/3?lerp(0.25,0.75,smooth(p*3)):p<2/3?lerp(0.75,1,(p-1/3)*3):lerp(1,0.12,smooth((p-2/3)/0.133));
  env.rain=damp(env.rain,rainT,1.5,dt);
  env.warm=damp(env.warm,run?smooth((p-0.667)/0.2):0,1.0,dt);
  for(const k in inp)inp[k]=kb[k]||tc[k];
  updateBanzeiro(dt);
  updatePlayer(dt);
  updateIntro(dt);
  updateCroc(dt);
  updateObstacles(dt);
  updateSnake(dt);
  updateVillage();
  updateForest();
  updateBanks();
  updateLightning(dt);
  updateCamera(dt);
  updateWorldFx(dt);
  SFX.update(env.rain,P.s/CFG.vMax,env.danger,dt,env.bz);
  updateDrops(dt);
  if(st==='playing'){
    const ph=phaseOf(p);
    if(ph!==G.phase){G.phase=ph;onPhase(ph);}
    while(G.evt<EVENTS.length&&t>=EVENTS[G.evt][0]){toast(EVENTS[G.evt][1]);G.evt++;}
    if(p>0.93&&!G.near){G.near=true;toast('As luzes da vila! Falta pouco!');}
    if(P.z<=zEnd())win();
    vignEl.style.opacity=env.danger*0.9;
  }
  if(G.endDelay>0){G.endDelay-=dt;if(G.endDelay<=0)endScreen(G.state==='won');}
  if(st==='lost')vignEl.style.opacity=Math.max(0,parseFloat(vignEl.style.opacity||0)-dt*0.25);
  if(st!=='menu')updateHUD(dt);
}

/* ============================================================
   RENDER + ANIMATION LOOP
   ============================================================ */
function setRainCenter(cam,dx,dz){rainMat.uniforms.uCenter.value.set(cam.position.x+dx*18,0,cam.position.z+dz*18);}
function render(){
  const W=innerWidth,H=innerHeight;
  renderer.setScissorTest(false);renderer.setViewport(0,0,W,H);
  sky.position.copy(camera.position);
  setRainCenter(camera,-Math.sin(camYaw),-Math.cos(camYaw));
  renderer.render(scene,camera);
  if(G.state!=='menu'&&G.state!=='intro'&&mirrorRect.w>1){
    const m=mirrorRect;
    renderer.setScissorTest(true);
    renderer.setViewport(m.x,H-m.y-m.h,m.w,m.h);renderer.setScissor(m.x,H-m.y-m.h,m.w,m.h);
    sky.position.copy(rearCam.position);
    setRainCenter(rearCam,Math.sin(P.yaw),Math.cos(P.yaw));
    renderer.render(scene,rearCam);
    renderer.setScissorTest(false);renderer.setViewport(0,0,W,H);
  }
}
let last=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  if(G.state!=='paused')update(dt);
  render();
}
/* arranque: o menu mostra o rio ao fundo enquanto a canoa desliza */
document.addEventListener('visibilitychange',()=>{if(document.hidden&&G.state==='playing')togglePause();});
onResize();renderScore();setUI();resetObstacles(false);
requestAnimationFrame(frame);
})();
