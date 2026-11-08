(function(){
'use strict';
if(typeof THREE==='undefined'){
  document.body.innerHTML='<p style="padding:2em;color:#fff;font-family:sans-serif">Não foi possível carregar o Three.js (CDN). Verifique sua conexão com a internet e recarregue a página.</p>';
  return;
}

/* ============================================================
   CONFIG
   ============================================================ */
const NAV=typeof navigator!=='undefined'?navigator:{};
const IS_TOUCH=('ontouchstart' in window)||(NAV.maxTouchPoints>0);
const MOBILE=/Android|iPhone|iPad|iPod/i.test(NAV.userAgent||'')||(IS_TOUCH&&innerWidth<1100);
const QL=['high','med','low'];
let quality='high';
try{const q=localStorage.getItem('fugaAmazonas.q');if(QL.indexOf(q)>=0)quality=q;else if(MOBILE)quality='med';}catch(e){if(MOBILE)quality='med';}
const QF={low:{pr:0.75,rain:0.5,mist:0,ff:0.4},med:{pr:MOBILE?1:1.25,rain:0.8,mist:1,ff:0.7},high:{pr:MOBILE?1.25:1.5,rain:1,mist:3,ff:1}};
let hapticsOn=true;
function buzz(p){if(!IS_TOUCH||!hapticsOn)return;try{if(NAV.vibrate)NAV.vibrate(p);}catch(e){}}
const CFG={
  duration:150,      // segundos para vencer
  startGap:48,       // distância inicial do jacaré (m)
  appearT:9,         // segundo em que o jacaré emerge
  catchDist:4,       // abaixo disso o jacaré pega a canoa
  dangerDist:24,     // abaixo disso começa o perigo
  maxGap:110,
  vMin:7, vMax:36, vTired:19,
  drain:0.09, regen:0.12, resumeAt:0.3,
  forestN:MOBILE?200:300, palmN:MOBILE?40:80, bushN:MOBILE?110:170, rockN:MOBILE?24:36, logN:MOBILE?24:36, obsN:9,
  rainN:MOBILE?2400:4500, sprayN:MOBILE?300:420,
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
/* Percurso: 6 fases medidas pela distância (um dia que vira noite e amanhece) */
const COURSE={L:5600,L1:5600,L2:2800,
  names:['A CHEIA','O ENCONTRO DAS ÁGUAS','O BANZEIRO','A TRILHA DE PEDRAS','A MATA CAÍDA','O IGAPÓ','A SECA','A BUSCA NA ALDEIA','RUMO AO POLO'],
  subs:['Troncos e camalotes bloqueiam o canal.','Dois rios, duas correntezas: o Negro é lento, o Solimões é rápido e traiçoeiro.','Ondas fortes — e a sucuri está caçando.','Pedras, corredeiras e quedas d’água.','O vento derruba árvores sobre o rio.','Floresta alagada: troncos em pé e névoa densa.','O rio encolheu: bancos de areia.','Siga o rio até a Aldeia Maripá e atraque no píer.','Leve a paciente ao Polo Base — cada batida pesa mais.'],
  story:['Você é técnico de enfermagem da saúde ribeirinha e indígena. A febre da criança não espera.','O Negro e o Solimões correm lado a lado sem se misturar. Escolha a sua correnteza.','O vento cresceu. O banzeiro vem de lado.','Anoitece. O rio vira uma trilha entre pedras.','Noite fechada. A tempestade derruba a mata.','O igapó engoliu as margens. Siga a luz do lampião.','Amanhece. A comunidade está perto — o jacaré também.','O rádio chamou: uma anciã espera na Aldeia Maripá, e a manhã mal começou.','A paciente precisa de avaliação médica no Polo Base. O jacaré voltou a seguir a canoa.']};
const PH={CHEIA:0,ENCONTRO:1,BANZEIRO:2,TRILHA:3,MATA:4,IGAPO:5,SECA:6,BUSCA:7,POLO:8};
let RUN_Z0=0,worldDirty=false,LEDGES=[],LD=[];
const LEDGE_DROP=3.0,LEDGE_W=14;
/* nível da água: cada queda d'água rebaixa o rio (usado por tudo que flutua ou apoia na margem) */
function lvl(z){let y=0;for(let i=0;i<LEDGES.length;i++){const t=clamp((LEDGES[i]+LEDGE_W/2-z)/LEDGE_W,0,1);y-=LEDGE_DROP*t*t*(3-2*t);}return y;}
const zEnd=()=>RUN_Z0-COURSE.L;
const progressAt=z=>clamp((RUN_Z0-z)/COURSE.L,0,1);
const phaseOf=p=>G.mission===2?(p<0.5?PH.BUSCA:PH.POLO):Math.min(6,Math.floor(p*7));
/* Encontro das Águas: faixa do percurso com duas correntezas separadas por uma linha sinuosa */
const bnd=z=>5*Math.sin(z*0.018+0.7);
const meetZ=()=>[RUN_Z0-COURSE.L/7,RUN_Z0-COURSE.L*2/7];
const meetW=z=>{if(!env.run||G.mission===2)return 0;const m=meetZ();return smooth((m[0]-z)/60)*smooth((z-m[1])/60);};
const laneK=(z,o)=>clamp((o-bnd(z))/3,-1,1);   // -1 = Rio Negro (lento) ... +1 = Solimões (rápido)
const pw=(x,pts)=>{if(x<=pts[0][0])return pts[0][1];for(let i=1;i<pts.length;i++){if(x<=pts[i][0]){const a=pts[i-1],b=pts[i];return lerp(a[1],b[1],(x-a[0])/(b[0]-a[0]));}}return pts[pts.length-1][1];};
const RAINK=[[0,.25],[.14,.6],[.29,.75],[.43,1],[.57,.8],[.71,1],[.86,.45],[.93,.12],[1,.05]];   // chuva ao longo do percurso
const DL=[[0,.85],[.2,.8],[.3,.65],[.4,.3],[.46,.06],[.55,0],[.84,0],[.92,.2],[1,.6]];         // luz do dia (1 = dia, 0 = noite)
const WARMK=[[0,0],[.2,.1],[.3,.25],[.4,.6],[.46,.15],[.55,0],[.84,0],[.92,.5],[1,1]];          // tom alaranjado (pôr do sol / amanhecer)
const RAIN2=[[0,.05],[.5,.1],[.8,.5],[1,.15]],DL2=[[0,.6],[.25,.9],[1,1]],WARM2=[[0,1],[.2,.4],[.4,0],[1,0]];   // manhã da missão 2
const igapoAt=p=>G.mission===2?0:smooth((p-0.70)/0.03)*(1-smooth((p-0.86)/0.03));
const dryAt=p=>G.mission===2?0:smooth((p-0.87)/0.08);
const zAld=()=>RUN_Z0-COURSE.L*0.5;   // aldeia da missão 2
const nearVillage=z=>Math.abs(z-(zEnd()-8))<34||(G.mission===2&&Math.abs(z-(zAld()-8))<34);
const riverW=z=>(60+10*Math.sin(z*0.011+1.3))*(1-0.15*igapoAt(progressAt(z)))*(1-0.36*dryAt(progressAt(z)));
const timeLabel=p=>G.mission===2?'MANHÃ':p<0.3?'TARDE':p<0.42?'ENTARDECER':p<0.85?'NOITE':p<0.95?'MADRUGADA':'AMANHECER';
const waveH=(x,z,t,a)=>a*(0.10*Math.sin(x*0.5+t*1.2)+0.08*Math.sin(z*0.4+t*2.0)+0.05*Math.sin((x+z)*0.9+t*2.6));

/* ============================================================
   GAME STATE
   ============================================================ */
let T=0; // tempo de animação global
const G={state:'menu',t:0,ti:0,endDelay:0,evt:0,phase:0,near:false,endP:0,acai:0,finalScore:0,newBest:false,mission:1,patient:false,m1done:false,board:null,dock:{t:0,warned:false,missed:0},cause:'croc',lostT:0,poloPlaced:false};
const P={z:0,o:0,vo:0,x:riverC(0),s:14,yaw:0,roll:0,pitch:0,waveY:0,stamina:1,exhausted:false,ph:0,hitCD:0,shake:0,kick:0,hp:100,inv:0,hurtT:0};
const C={D:CFG.startGap,o:0,x:0,z:0,yaw:0,surf:0,surfTarget:0,emerged:false,diving:false,diveT:0,nextDive:16,nextSurge:12,surgeT:0,beatT:0,vC:14,prevO:0};
const env={rain:0.45,flash:0,danger:0,bz:0,warm:0,p:0,dl:0.85,ig:0,cloud:1,fall:0,run:false};
const waveAmp=()=>0.9+0.9*env.rain+1.5*env.bz;
const kb={left:false,right:false,up:false,down:false}, tc={left:false,right:false,up:false,down:false,axis:0}, inp={left:false,right:false,up:false,down:false,axis:0};

/* ============================================================
   SCENE
   ============================================================ */
const app=$('app');
const renderer=new THREE.WebGLRenderer({antialias:!MOBILE&&quality!=='low',powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,QF[quality].pr));
renderer.setSize(innerWidth,innerHeight);
renderer.setClearColor(CFG.fog);
app.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const fogBase=new THREE.Color(CFG.fog), fogFlash=new THREE.Color(0x9fb0c8), fogTmp=new THREE.Color();
const fogCool=new THREE.Color(CFG.fog),fogWarm=new THREE.Color(0x7d5c48),zenCool=new THREE.Color(0x0c1412),zenWarm=new THREE.Color(0x2c2538);
const hemiCool=new THREE.Color(0x8fa6a8),hemiWarm=new THREE.Color(0xd9a070),fogNight=new THREE.Color(0x0b1014),zenNight=new THREE.Color(0x03050a),hemiNight=new THREE.Color(0x4f6590),sunNight=new THREE.Color(0x8fa6d8),sunCool=new THREE.Color(0xaab8c0),sunWarm=new THREE.Color(0xffb070);
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
  uniforms:{uTime:{value:0},uFlash:{value:0},uHorizon:{value:new THREE.Color(CFG.fog)},uZenith:{value:new THREE.Color(0x0c1412)},uNight:{value:0},uCloud:{value:1},uWarm:{value:0}},
  vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
  fragmentShader:`varying vec3 vDir;uniform float uTime,uFlash,uNight,uCloud,uWarm;uniform vec3 uHorizon,uZenith;
  ${NOISE_GLSL}
  float fbm(vec2 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){s+=a*vnoise(p);p*=2.03;a*=0.5;}return s;}
  void main(){
    vec3 d=normalize(vDir);
    float h=clamp(d.y,0.0,1.0);
    vec3 col=mix(uHorizon,uZenith,pow(h,0.5));
    vec2 uv=d.xz/(max(d.y,0.0)+0.4)*1.4+vec2(uTime*0.012,uTime*0.006);
    float c=fbm(uv*1.6);
    col*=mix(1.0,0.7+0.65*c,uCloud);
    col+=vec3(0.5,0.58,0.75)*uFlash*(0.4+c)*(0.3+h);
    vec2 sg=vec2(atan(d.z,d.x)*40.0,d.y*60.0);
    float st=step(0.985,hash(floor(sg)))*(1.0-smoothstep(0.0,0.35,length(fract(sg)-0.5)));
    col+=vec3(0.8,0.85,1.0)*st*uNight*smoothstep(0.05,0.3,d.y)*(1.0-clamp(c*1.4,0.0,1.0)*uCloud)*1.2;
    col+=vec3(1.0,0.55,0.25)*pow(max(dot(d,normalize(vec3(0.3,0.08,-1.0))),0.0),6.0)*uWarm*(1.0-0.6*c*uCloud)*0.9;
    float md=dot(d,normalize(vec3(-0.35,0.5,-0.8)));
    col+=vec3(0.75,0.8,0.95)*smoothstep(0.9985,0.9995,md)*uNight*(1.0-0.85*c*uCloud)*1.6;
    col+=vec3(0.2,0.25,0.4)*smoothstep(0.96,0.9985,md)*uNight*(1.0-c*uCloud)*0.5;
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
    uSky:{value:new THREE.Color(CFG.fog)},uCanoe:{value:new THREE.Vector2()},uCroc:{value:new THREE.Vector2(0,9999)},uCrocVis:{value:0},
    uLed:{value:[0,0,0]},uLedN:{value:0},uLamp:{value:new THREE.Vector3()},uLampI:{value:0},uMoon:{value:0},
    uWx:{value:[0,0,0]},uWz:{value:[0,0,0]},uWr:{value:[1,1,1]},uMeetA:{value:0},uMeetB:{value:0},uMeetOn:{value:0}
  }]),
  vertexShader:`
  uniform float uTime,uAmp,uLedN;uniform float uLed[3];uniform float uWx[3],uWz[3],uWr[3];varying vec3 vWorld;
  float lvl(float z){float y=0.0;for(int i=0;i<3;i++){if(float(i)<uLedN){float t=clamp((uLed[i]+7.0-z)/14.0,0.0,1.0);y-=3.0*t*t*(3.0-2.0*t);}}return y;}
  #include <fog_pars_vertex>
  float waveH(vec2 p,float t){return uAmp*(0.10*sin(p.x*0.5+t*1.2)+0.08*sin(p.y*0.4+t*2.0)+0.05*sin((p.x+p.y)*0.9+t*2.6));}
  void main(){
    vec4 wp=modelMatrix*vec4(position,1.0);
    wp.y+=waveH(wp.xz,uTime)+lvl(wp.z);
    for(int i=0;i<3;i++){float dd=length(wp.xz-vec2(uWx[i],uWz[i]));wp.y-=1.2*exp(-dd*dd/(uWr[i]*uWr[i]*0.6));}
    vWorld=wp.xyz;
    vec4 mvPosition=viewMatrix*wp;
    gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
  }`,
  fragmentShader:`
  uniform float uTime,uAmp,uRain,uFlash,uSpeed,uCrocVis,uLedN,uLampI,uMoon;uniform float uLed[3];uniform float uWx[3],uWz[3],uWr[3];uniform float uMeetA,uMeetB,uMeetOn;
  uniform vec3 uSky,uLamp;uniform vec2 uCanoe,uCroc;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  float waveH(vec2 p,float t){return uAmp*(0.10*sin(p.x*0.5+t*1.2)+0.08*sin(p.y*0.4+t*2.0)+0.05*sin((p.x+p.y)*0.9+t*2.6));}
  /* esteira em V atrás de um objeto que avança para -z */
  float wake(vec2 p,vec2 o,float len,float k,float amt){
    vec2 d=p-o;
    float behind=smoothstep(-0.5,1.5,d.y)*(1.0-smoothstep(len*0.5,len,d.y));
    float w=0.55+max(d.y,0.0)*k;
    float lines=(1.0-smoothstep(0.0,0.45,abs(abs(d.x)-w)));
    float core=(1.0-smoothstep(0.0,w,abs(d.x)))*0.35;
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
    grad+=(vec2(vnoise(p*7.0+vec2(uTime*0.8,-uTime*0.5)),vnoise(p*6.0-vec2(uTime*0.6,uTime*0.7)))-0.5)*0.06;
    float ledFoam=0.0;
    for(int i=0;i<3;i++){if(float(i)<uLedN){
      float zl=uLed[i];float t=clamp((zl+7.0-p.y)/14.0,0.0,1.0);
      grad.y+=3.0*6.0*t*(1.0-t)/14.0;
      float nr=(1.0-smoothstep(0.0,9.0,abs(p.y-zl)));
      float bs=(1.0-smoothstep(2.0,20.0,zl-8.0-p.y))*step(0.0,zl-8.0-p.y);
      ledFoam+=(nr*0.9+bs*0.8)*(0.5+0.9*vnoise(p*vec2(1.1,0.8)+vec2(0.0,uTime*5.0)));
    }}
    float ring=0.0;
    for(int k=0;k<2;k++){
      float sc=2.0+float(k)*1.9;
      vec2 q=p*sc+vec2(float(k)*17.3,float(k)*9.1);
      vec2 g=floor(q),f=fract(q);
      float hh=hash(g+float(k)*3.7);
      float tt=fract(uTime*0.9+hh*7.0);
      vec2 c=vec2(hash(g+1.7),hash(g+3.1))*0.6+0.2;
      float d=length(f-c);
      ring+=(1.0-smoothstep(0.0,0.07,abs(d-tt*0.45)))*(1.0-tt)*step(hh,uRain*0.85);
    }
    vec3 N=normalize(vec3(-grad.x,1.0,-grad.y));
    vec3 V=normalize(cameraPosition-vWorld);
    float fres=pow(1.0-max(dot(N,V),0.0),3.0);
    float mz=clamp((uMeetA-p.y)/60.0,0.0,1.0)*clamp((p.y-uMeetB)/60.0,0.0,1.0);
    mz=mz*mz*(3.0-2.0*mz)*uMeetOn;
    float bx=16.0*sin(p.y*0.012)+6.0*sin(p.y*0.031+2.0)+5.0*sin(p.y*0.018+0.7);
    float sd=p.x-bx+1.8*(vnoise(vec2(p.y*0.35,uTime*0.6))-0.5);
    float lane=smoothstep(-1.2,1.2,sd);
    float edgeFoam=(1.0-smoothstep(0.0,2.2,abs(sd)))*mz*(0.5+0.9*vnoise(p*vec2(1.5,3.0)+vec2(0.0,uTime*2.0)));
    float whF=0.0,whD=0.0;
    for(int i=0;i<3;i++){
      vec2 dv=p-vec2(uWx[i],uWz[i]);float rr=length(dv),RR=uWr[i];
      if(rr<RR*1.7){
        float an=atan(dv.y,dv.x+0.0001)+RR*1.3/(rr+0.6)-uTime*2.5;
        whF+=smoothstep(0.55,1.0,sin(an*3.0))*(1.0-smoothstep(RR*0.1,RR*1.6,rr))*0.9;
        whD+=1.0-smoothstep(0.0,RR*0.6,rr);
      }
    }
    vec3 deep=mix(vec3(0.085,0.095,0.06),mix(vec3(0.022,0.028,0.03),vec3(0.30,0.22,0.12),lane),mz);
    deep*=1.0-0.5*min(whD,1.0);
    vec3 col=mix(deep,uSky*1.1,clamp(0.10+0.85*fres+0.18*(1.0-lane)*mz,0.0,1.0));
    vec3 Lg=normalize(vec3(-0.35,0.55,-0.8));
    float nh=max(dot(N,normalize(Lg+V)),0.0);
    col+=pow(nh,45.0)*(0.12+uFlash*1.2+uMoon*1.6)+pow(nh,10.0)*0.12*uMoon;
    float fs=vnoise(vec2(p.x*0.7,p.y*0.16));
    float foam=smoothstep(0.66,0.88,fs)*vnoise(p*2.3)*0.35;
    float kk=clamp(uSpeed/20.0,0.35,1.5);
    float wk=wake(p,uCanoe,26.0,0.17,kk)+rings(p,uCanoe,0.35);
    float wc=(wake(p,uCroc,22.0,0.14,1.0)+rings(p,uCroc,0.45))*uCrocVis;
    float foamAll=foam+wk*0.9+wc*0.9+ring*0.28+ledFoam+edgeFoam*0.9+whF;
    col=mix(col,vec3(0.62,0.68,0.66)+uFlash*0.3,clamp(foamAll,0.0,0.8)*0.65);
    col+=uFlash*vec3(0.12,0.14,0.2)*(0.3+fres);
    float ld=length(p-uLamp.xz);
    col+=vec3(1.0,0.72,0.38)*uLampI*exp(-ld*0.16)*(0.12+0.8*fres);
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
        pos[k+1]=BANK_H[i]+(i>0?(hash1(row*1.7+i*3.1+b.side)-0.5)*(0.3+i*0.25):0)+lvl(z);
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
const lamp=new THREE.PointLight(0xffc070,0,40,2);lamp.position.set(0,1.1,-2.2);canoeG.add(lamp);
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
const trunks=makeInst(trunkGeo,CFG.forestN),crowns=makeInst(new THREE.IcosahedronGeometry(1,1),CFG.forestN*3),vines=makeInst(vineGeo,CFG.forestN*2);
const bushes=makeInst(new THREE.IcosahedronGeometry(1,0),CFG.bushN),rocks=makeInst(new THREE.DodecahedronGeometry(1,0),CFG.rockN),shoreLogs=makeInst(logGeo,CFG.logN);
function mergeGeos(list){ // junta geometrias simples em uma só (com cor por vértice)
  const pos=[],nor=[],col=[],idx=[];let off=0;
  for(const it of list){
    const g=it.g,p=g.attributes.position,n=g.attributes.normal;
    for(let i=0;i<p.count;i++){pos.push(p.getX(i),p.getY(i),p.getZ(i));nor.push(n.getX(i),n.getY(i),n.getZ(i));col.push(it.c[0],it.c[1],it.c[2]);}
    if(g.index)for(let i=0;i<g.index.count;i++)idx.push(g.index.getX(i)+off);else for(let i=0;i<p.count;i++)idx.push(i+off);
    off+=p.count;
  }
  const m=new THREE.BufferGeometry();
  m.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));m.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));
  m.setAttribute('color',new THREE.Float32BufferAttribute(col,3));m.setIndex(idx);return m;
}
const palmGeo=(function(){
  const list=[];
  const tr=new THREE.CylinderGeometry(0.16,0.26,11,6);tr.translate(0,5.5,0);list.push({g:tr,c:[0.28,0.2,0.13]});
  for(let i=0;i<9;i++){                       // 9 folhas achatadas e caídas
    const g=new THREE.ConeGeometry(0.4,4.6,4);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0,11,0)
      .multiply(new THREE.Matrix4().makeRotationY(i*0.698+(i%2)*0.2))
      .multiply(new THREE.Matrix4().makeRotationX(1.7+(i%3)*0.12))
      .multiply(new THREE.Matrix4().makeTranslation(0,2.3,0))
      .multiply(new THREE.Matrix4().makeScale(1,1,0.18)));
    list.push({g,c:[0.16+(i%2)*0.04,0.34,0.12]});
  }
  return mergeGeos(list);
})();
const palms=new THREE.InstancedMesh(palmGeo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}),CFG.palmN);
palms.frustumCulled=false;palms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(palms);
function placePalm(i,z){
  palmZ[i]=z;const side=sidePick(),dist=rand(0.8,12)+(nearVillage(z)?40:0),x=riverC(z)+side*(riverW(z)/2+dist),sc=rand(0.55,0.85);
  palmX[i]=x;
  put(palms,i,x,bankY(dist)-0.2+lvl(z),z,rand(-0.1,0.1),rand(0,6.28),rand(-0.1,0.1),sc,sc,sc,0,0,0.7+rand(0,0.3));
}
const treeZ=new Float32Array(CFG.forestN),bushZ=new Float32Array(CFG.bushN),rockZ=new Float32Array(CFG.rockN),logZ=new Float32Array(CFG.logN),treeX=new Float32Array(CFG.forestN),bushX=new Float32Array(CFG.bushN),rockX=new Float32Array(CFG.rockN),logX=new Float32Array(CFG.logN),palmZ=new Float32Array(CFG.palmN),palmX=new Float32Array(CFG.palmN);
const FOREST_BEHIND=120,FOREST_AHEAD=250,SPAN=FOREST_BEHIND+FOREST_AHEAD;
const sidePick=()=>Math.random()<0.5?-1:1;
function put(mesh,i,x,y,z,rx,ry,rz,sx,sy,sz,h,s,l){
  dummy.position.set(x,y,z);dummy.rotation.set(rx,ry,rz);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();
  mesh.setMatrixAt(i,dummy.matrix);colTmp.setHSL(h,s,l);mesh.setColorAt(i,colTmp);
}
function placeTree(i,z){
  treeZ[i]=z;const side=sidePick(),hw=riverW(z)/2;
  const dist=1.8+(Math.random()<0.55?Math.random()*7:7+Math.random()*38)+(nearVillage(z)?40:0);
  const x=riverC(z)+side*(hw+dist),h=rand(7,13),r=rand(0.6,1.0),y0=bankY(dist)-0.8+lvl(z);treeX[i]=x;
  put(trunks,i,x,y0,z,rand(-.04,.04),rand(0,6.28),rand(-.04,.04),r,h,r,0.075+rand(0,0.03),0.22+rand(0,.1),0.12+rand(0,.07));
  const cs=rand(3,5.2),cy=rand(1.6,2.6);
  put(crowns,3*i,x,y0+h,z,0,rand(0,6.28),0,cs,cy,cs*rand(.85,1.15),0.26+rand(0,.06),0.38+rand(0,.2),0.10+rand(0,.08));
  put(crowns,3*i+1,x+rand(-2,2),y0+h-rand(0.7,2.5),z+rand(-2,2),0,rand(0,6.28),0,cs*.7,cy*.8,cs*.7,0.27+rand(0,.06),0.4+rand(0,.2),0.09+rand(0,.08));
  put(crowns,3*i+2,x+rand(-2.5,2.5),y0+h+rand(0.3,1.2),z+rand(-2,2),0,rand(0,6.28),0,cs*.6,cy*.9,cs*.6,0.28+rand(0,.06),0.45+rand(0,.2),0.14+rand(0,.08));
  for(let k=0;k<2;k++)put(vines,2*i+k,x-side*rand(0.5,cs*0.8),y0+h-cy*0.4,z+rand(-cs,cs)*0.6,0,0,0,1,rand(2.5,6),1,0.25,0.4,0.12);
}
function placeBush(i,z){
  bushZ[i]=z;const side=sidePick(),dist=rand(0.6,9)+(nearVillage(z)?40:0),x=riverC(z)+side*(riverW(z)/2+dist),s=rand(1,2.6);bushX[i]=x;
  put(bushes,i,x,bankY(dist)+0.1+lvl(z),z,0,rand(0,6.28),0,s*rand(1,1.6),s*rand(.6,1),s*rand(1,1.6),0.24+rand(0,.08),0.45+rand(0,.2),0.13+rand(0,.1));
}
function placeRock(i,z){
  rockZ[i]=z;const side=sidePick(),dist=rand(-1.8,3.5)+(nearVillage(z)?40:0),x=riverC(z)+side*(riverW(z)/2+dist),s=rand(0.7,2);rockX[i]=x;
  put(rocks,i,x,bankY(dist)+lvl(z),z,rand(0,3),rand(0,6),rand(0,3),s,s*0.7,s,0.1,0.05+rand(0,.05),0.2+rand(0,.12));
}
function placeLog(i,z){
  logZ[i]=z;const side=sidePick(),dist=rand(0,5)+(nearVillage(z)?40:0),x=riverC(z)+side*(riverW(z)/2+dist);logX[i]=x;
  put(shoreLogs,i,x,bankY(dist)+0.2+lvl(z),z,0,rand(-0.4,0.4),0,1,1,rand(4,9),0.07,0.25,0.12+rand(0,.07));
}
function flagForest(){for(const m of[trunks,crowns,vines,bushes,rocks,shoreLogs,palms]){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}}
function rebuildForest(){
  const z0=P.z+FOREST_BEHIND;
  for(let i=0;i<CFG.forestN;i++)placeTree(i,z0-Math.random()*SPAN);
  for(let i=0;i<CFG.bushN;i++)placeBush(i,z0-Math.random()*SPAN);
  for(let i=0;i<CFG.rockN;i++)placeRock(i,z0-Math.random()*SPAN);
  for(let i=0;i<CFG.logN;i++)placeLog(i,z0-Math.random()*SPAN);
  for(let i=0;i<CFG.palmN;i++)placePalm(i,z0-Math.random()*SPAN);
  flagForest();
}
rebuildForest();
function updateForest(){
  const lim=P.z+FOREST_BEHIND;let dirty=false;
  for(let i=0;i<CFG.forestN;i++)if(treeZ[i]>lim){placeTree(i,treeZ[i]-SPAN);dirty=true;}
  for(let i=0;i<CFG.bushN;i++)if(bushZ[i]>lim){placeBush(i,bushZ[i]-SPAN);dirty=true;}
  for(let i=0;i<CFG.rockN;i++)if(rockZ[i]>lim){placeRock(i,rockZ[i]-SPAN);dirty=true;}
  for(let i=0;i<CFG.logN;i++)if(logZ[i]>lim){placeLog(i,logZ[i]-SPAN);dirty=true;}
  for(let i=0;i<CFG.palmN;i++)if(palmZ[i]>lim){placePalm(i,palmZ[i]-SPAN);dirty=true;}
  if(dirty)flagForest();
}

/* Obstáculos do rio: troncos, pedras, camalotes, bancos de areia e troncos em pé (igapó) */
const OB={pool:[],front:0,on:false,gap:0};
const KINDS=['log','rock','camalote','sand','stump'];
const KIND_W=[[0.45,0.2,0.35,0,0],[0.45,0.05,0.5,0,0],[0.5,0.25,0.25,0,0],[0,1,0,0,0],[0.5,0.2,0.3,0,0],[0,0,0,0,1],[0.3,0.12,0.18,0.4,0],[0.4,0.1,0.5,0,0],[0.4,0.25,0.2,0.15,0]]; // por fase
(function(){
  const lg=new THREE.CylinderGeometry(0.4,0.46,1,7);lg.rotateX(Math.PI/2);
  const mat=c=>new THREE.MeshLambertMaterial({color:c,emissive:0x0e1a12,flatShading:true}); // brilho mínimo: enxerga à noite
  const defs={
    log:[lg,mat(0x4b3827),6],
    rock:[new THREE.DodecahedronGeometry(1,0),mat(0x5a5d5c),30],
    camalote:[new THREE.IcosahedronGeometry(1,1),mat(0x4a8a30),5],
    sand:[new THREE.CylinderGeometry(1,1,0.3,16),mat(0xb89a64),6],
    stump:[new THREE.CylinderGeometry(0.7,0.95,5,7),mat(0x3d3024),14]
  };
  for(const kind of KINDS){const d=defs[kind];for(let i=0;i<d[2];i++){
    const mesh=new THREE.Mesh(d[0],d[1]);mesh.visible=false;scene.add(mesh);
    OB.pool.push({kind,mesh,active:false,hw:1,hl:1,r:1,x:0,z:1e9,rot:0,ph:Math.random()*6,inside:false});
  }}
})();
function pickKind(ph){const w=KIND_W[ph];let r=Math.random(),i=0;for(;i<4;i++){if(r<w[i])break;r-=w[i];}return KINDS[i];}
function placeObstacle(o,z,off,sz){
  const hw=riverW(z)/2-6;
  if(off===undefined){
    off=Math.random()<0.4?P.o+rand(-8,8):rand(-hw,hw);
    if(o.kind==='sand'&&Math.random()<0.5)off=(Math.random()<0.5?-1:1)*rand(hw*0.35,hw);
    if(phaseOf(progressAt(z))===PH.ENCONTRO){const b=bnd(z);off=Math.random()<0.85?rand(-hw,b-4):rand(b+4,hw);} // detritos no Negro, redemoinhos no Solimões
    off=clamp(off,-hw,hw);
  }
  o.z=z;o.x=riverC(z)+off;o.inside=false;o.active=true;
  const m=o.mesh;
  if(o.kind==='log'){const len=rand(4,7),rad=rand(0.8,1.2);m.scale.set(rad,rad,len);o.rot=rand(-0.6,0.6);o.hw=0.45*rad+0.2;o.hl=len/2;}
  else if(o.kind==='rock'){const r=sz||rand(1,1.7);m.scale.set(r,r*0.75,r);o.rot=rand(0,6);o.hw=o.hl=r*0.9;}
  else if(o.kind==='stump'){const r=sz||rand(0.9,1.4);m.scale.set(r,rand(0.8,1.2),r);o.rot=rand(0,6);o.hw=o.hl=r*0.95;}
  else if(o.kind==='camalote'){const r=rand(2.2,4.2);m.scale.set(r,0.28,r*rand(0.8,1.2));o.rot=rand(0,6);o.r=r*0.9;}
  else{const r=rand(3,6.5);m.scale.set(r,1,r*rand(0.7,1.1));o.rot=rand(0,6);o.r=r*0.9;}
  m.rotation.set(0,o.rot,0);m.visible=true;
}
/* fileira de pedras (ou troncos em pé) atravessando o rio, com uma passagem: a "trilha" */
function spawnGate(kind,z,gapW,step){
  const hw=riverW(z)/2;
  OB.gap=clamp(OB.gap+rand(-12,12),-hw+gapW,hw-gapW);
  for(let x=-hw+2.5;x<=hw-2.5;x+=step){
    if(Math.abs(x-OB.gap)<gapW/2)continue;
    const o=OB.pool.find(q=>!q.active&&q.kind===kind);if(!o)break;
    placeObstacle(o,z+rand(-1.5,1.5),x+rand(-0.8,0.8),kind==='rock'?rand(1.6,2.4):rand(1,1.5));
  }
}
function spawnOne(){
  const p=progressAt(OB.front),ph=phaseOf(p);
  const z=OB.front-((ph===PH.TRILHA||ph===PH.IGAPO)?rand(36,44):lerp(48,24,smooth(p*1.2))*rand(0.75,1.3));
  if(z<zEnd()+60){OB.on=false;return false;}  // área da vila fica livre
  OB.front=z;
  if(G.mission===2&&Math.abs(z-zAld())<70)return true;   // píer da aldeia fica livre
  if(LEDGES.some(l=>Math.abs(z-l)<24))return true; // nada em cima das quedas d'água
  const phz=phaseOf(progressAt(z));
  if(phz===PH.TRILHA)spawnGate('rock',z,11,5.5);
  else if(phz===PH.IGAPO)spawnGate('stump',z,9,4.5);
  else{const o=OB.pool.find(q=>!q.active&&q.kind===pickKind(phz));if(o)placeObstacle(o,z);}
  return true;
}
function resetObstacles(active){
  OB.front=P.z-100;OB.on=!!active;OB.gap=0;
  for(const o of OB.pool){o.active=false;o.mesh.visible=false;o.z=1e9;o.inside=false;}
  PK.front=P.z-80;PK.on=!!active;KT.front=P.z-150;KT.on=!!active;
  for(const q of KT.pool){q.active=false;q.mesh.visible=false;}
  for(const q of PK.pool){q.active=false;q.mesh.visible=false;}
}
function updateObstacles(dt){
  const amp=waveAmp(),playing=G.state==='playing';
  if(OB.on)for(let n=0;n<10&&OB.front>P.z-240;n++)if(!spawnOne())break;
  for(const o of OB.pool){
    if(!o.active)continue;
    if(o.z>P.z+30){o.active=false;o.mesh.visible=false;continue;}
    const bob=waveH(o.x,o.z,T,amp)*0.8;
    const y=(o.kind==='log'?0.1+bob:o.kind==='rock'?0.15+bob:o.kind==='stump'?0.6:o.kind==='camalote'?0.06+bob*0.9:0.1)+lvl(o.z);
    o.mesh.position.set(o.x,y+Math.sin(T*1.3+o.ph)*0.03,o.z);
    if(!playing)continue;
    const dx=P.x-o.x,dz=P.z-o.z;
    if(o.kind==='camalote'||o.kind==='sand'){
      const inside=Math.hypot(dx,dz)<o.r+0.8;
      if(inside){
        if(o.kind==='camalote')P.s=Math.max(P.s-16*dt,8);
        else{P.s=Math.max(P.s-30*dt,5);P.stamina=Math.max(0,P.stamina-0.1*dt);P.shake=Math.max(P.shake,0.25);}
        if(!o.inside){
          if(o.kind==='sand'){SFX.scrape();toast('ENCALHOU! Saia do banco de areia!');}else SFX.leaf();
          emitSpray(P.x,0.2,P.z,8,2,3);
        }
      }
      o.inside=inside;
    }else{
      if(P.hitCD>0)continue;
      const c=Math.cos(o.rot),sn=Math.sin(o.rot),lx=dx*c-dz*sn,lz=dx*sn+dz*c;
      if(Math.abs(lx)<o.hw+0.65&&Math.abs(lz)<o.hl+2.0){
        P.s=Math.max(CFG.vMin*0.8,P.s*0.45);P.vo+=(dx>=0?1:-1)*6;P.shake=Math.max(P.shake,0.9);P.hitCD=0.8;
        SFX.thud();emitSpray(P.x,0.3,P.z,22,4,6);hurt(o.kind==='log'?12:15);
      }
    }
  }
}

/* Açaí: frutas flutuantes que devolvem fôlego e valem pontos */
const PK={pool:[],front:0,on:false};
(function(){
  const g=new THREE.SphereGeometry(0.4,10,8),m=new THREE.MeshLambertMaterial({color:0x7a3fe0,emissive:0x3a1580});
  for(let i=0;i<12;i++){const mesh=new THREE.Mesh(g,m);mesh.visible=false;scene.add(mesh);PK.pool.push({mesh,active:false,x:0,z:1e9,ph:Math.random()*6});}
})();
function spawnPickups(z){
  const hw=riverW(z)/2-6,o0=rand(-hw,hw);let k=0;
  for(const q of PK.pool){
    if(q.active)continue;if(k>=4)break;
    const zz=z-k*7;q.active=true;q.z=zz;q.x=riverC(zz)+clamp(o0+Math.sin(k*0.9)*4,-hw,hw);q.mesh.visible=true;k++;
  }
}
function updatePickups(dt){
  const playing=G.state==='playing';
  if(PK.on)while(PK.front>P.z-230){const z=PK.front-rand(70,120);if(z<zEnd()+70){PK.on=false;break;}spawnPickups(z);PK.front=z-30;}
  for(const q of PK.pool){
    if(!q.active)continue;
    if(q.z>P.z+30){q.active=false;q.mesh.visible=false;continue;}
    q.mesh.position.set(q.x,0.55+0.15*Math.sin(T*3+q.ph)+waveH(q.x,q.z,T,waveAmp())*0.8+lvl(q.z),q.z);
    if(playing&&Math.hypot(P.x-q.x,P.z-q.z)<1.9){
      q.active=false;q.mesh.visible=false;G.acai++;P.stamina=Math.min(1,P.stamina+0.2);SFX.pickup();emitSpray(q.x,0.3,q.z,6,3,2);
    }
  }
}

/* Kit de primeiros socorros: cura +25 de vida (raro) */
const KT={pool:[],front:0,on:false};
(function(){
  const g=new THREE.BoxGeometry(0.9,0.55,0.65),m=new THREE.MeshLambertMaterial({color:0xefe9d8,emissive:0x2a2420}),red=new THREE.MeshBasicMaterial({color:0xd0352b});
  for(let i=0;i<3;i++){
    const mesh=new THREE.Mesh(g,m);
    const a=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.02,0.14),red),b=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.02,0.5),red);
    a.position.y=b.position.y=0.285;mesh.add(a,b);mesh.visible=false;scene.add(mesh);
    KT.pool.push({mesh,active:false,x:0,z:1e9,ph:Math.random()*6});
  }
})();
function updateKits(dt){
  const playing=G.state==='playing';
  if(KT.on)while(KT.front>P.z-230){
    const z=KT.front-rand(380,520);KT.front=z;
    if(z<zEnd()+80){KT.on=false;break;}
    const q=KT.pool.find(k=>!k.active);if(!q)break;
    const hw=riverW(z)/2-6;q.active=true;q.z=z;q.x=riverC(z)+rand(-hw,hw);q.mesh.visible=true;
  }
  for(const q of KT.pool){
    if(!q.active)continue;
    if(q.z>P.z+30){q.active=false;q.mesh.visible=false;continue;}
    q.mesh.position.set(q.x,0.45+0.1*Math.sin(T*2.5+q.ph)+waveH(q.x,q.z,T,waveAmp())*0.8+lvl(q.z),q.z);
    q.mesh.rotation.y=T*0.8+q.ph;
    if(playing&&Math.hypot(P.x-q.x,P.z-q.z)<2.3){
      q.active=false;q.mesh.visible=false;P.hp=Math.min(100,P.hp+25);SFX.pickup();toast('🩹 Kit de primeiros socorros: +25 de vida');
    }
  }
}

/* Quedas d'água: pedras nas margens, espuma, névoa e um impulso ao descer */
const LR=makeInst(new THREE.DodecahedronGeometry(1,0),24);
function placeLedgeRocks(){
  let n=0;
  for(const zl of LEDGES)for(let k=0;k<12;k++){
    const z=zl+rand(-9,9),hw=riverW(z)/2,side=k%2?1:-1,s=rand(1.6,3.0);
    put(LR,n++,riverC(z)+side*hw*rand(0.66,0.95),lvl(z)+0.2,z,rand(0,3),rand(0,6),rand(0,3),s,s*0.8,s,0.1,0.05,0.2+rand(0,0.1));
  }
  for(;n<24;n++)put(LR,n,0,-200,0,0,0,0,0.01,0.01,0.01,0.1,0.05,0.2);
  LR.instanceMatrix.needsUpdate=true;if(LR.instanceColor)LR.instanceColor.needsUpdate=true;
}
placeLedgeRocks();
function updateLedges(dt){
  const playing=G.state==='playing';let near=0;
  for(let i=0;i<LEDGES.length;i++){
    const zl=LEDGES[i],st=LD[i],dz=P.z-zl;
    if(dz>-100&&dz<180&&Math.random()<0.9){const hw=riverW(zl)/2;emitSpray(riverC(zl-9)+rand(-hw,hw)*0.9,0.2,zl-9+rand(-3,3),2,5,2);}
    near=Math.max(near,dz>0?clamp(1-dz/160,0,1):clamp(1+dz/80,0,1));
    if(!playing)continue;
    if(!st.warned&&dz<150&&dz>0){st.warned=true;showBanner('QUEDA D’ÁGUA!','Fique no centro do canal e segure firme');}
    if(Math.abs(dz)<7){
      P.s=Math.min(P.s+12*dt,40);
      if(!st.hit&&!st.done&&Math.abs(P.o)>riverW(zl)/2*0.62){st.hit=true;P.s*=0.5;P.shake=Math.max(P.shake,1);SFX.thud();toast('Bateu nas pedras da queda!');hurt(18);}
    }
    if(!st.done&&dz<-7){st.done=true;SFX.splash(1);emitSpray(P.x,0.3,P.z,40,7,6);P.shake=Math.max(P.shake,0.8);buzz(60);if(!st.hit)toast('Desceu a queda d’água!');}
  }
  env.fall=damp(env.fall,near,3,dt);
}

/* Árvores caindo: bloqueiam o rio, deixando só um lado livre */
const FT={pool:[],next:99};
(function(){
  const tg=new THREE.CylinderGeometry(0.6,0.95,1,8);tg.translate(0,0.5,0);
  const cg=new THREE.IcosahedronGeometry(1,1);
  const tm=new THREE.MeshLambertMaterial({color:0x3a2c20,emissive:0x0e1a12}),cm=new THREE.MeshLambertMaterial({color:0x1f4a22,emissive:0x0a160a,flatShading:true});
  for(let i=0;i<2;i++){
    const g=new THREE.Group(),trunk=new THREE.Mesh(tg,tm),crown=new THREE.Mesh(cg,cm),crown2=new THREE.Mesh(cg,cm);
    g.add(trunk,crown,crown2);g.visible=false;scene.add(g);
    FT.pool.push({g,trunk,crown,crown2,active:false,state:0,ang:0,angF:1.55,t:0,side:1,z:0,xb:0,yb:0,len:40,hitCD:0});
  }
})();
function resetTrees(){FT.next=99;for(const f of FT.pool){f.active=false;f.g.visible=false;}}
function spawnTree(){
  const f=FT.pool.find(q=>!q.active);if(!f)return;
  const z=P.z-rand(115,150);if(z<zEnd()+100)return;
  const side=Math.random()<0.5?-1:1,hw=riverW(z)/2;
  f.active=true;f.state=0;f.ang=0;f.t=0;f.side=side;f.z=z;f.hitCD=0;
  f.len=hw*1.3+rand(-2,2);
  f.xb=riverC(z)+side*(hw+1.2);f.yb=groundY(side,z,1.2)-0.3;
  f.angF=Math.PI/2-Math.asin(clamp((f.yb-lvl(z)+0.1)/f.len,0,0.5));
  f.trunk.scale.set(0.75,f.len,0.75);
  f.crown.position.set(0,f.len,0);f.crown.scale.set(4.5,2.6,4.5);
  f.crown2.position.set(1.8,f.len-2.2,1.2);f.crown2.scale.set(3.4,2,3.4);
  f.g.position.set(f.xb,f.yb,z);f.g.rotation.set(0,0,0);f.g.visible=true;
}
function updateTrees(dt){
  const playing=G.state==='playing';
  if(playing&&G.phase>=PH.MATA){FT.next-=dt;if(FT.next<=0){spawnTree();FT.next=G.phase===PH.MATA?rand(8,13):rand(20,30);}}
  for(const f of FT.pool){
    if(!f.active)continue;
    if(f.z>P.z+70){f.active=false;f.g.visible=false;continue;}
    f.hitCD-=dt;
    if(f.state===0){
      f.ang=0.015*Math.sin(T*2.5+f.z);
      if(playing&&P.z-f.z<95){f.state=1;f.t=0;SFX.creak();toast('🌳 Árvore caindo! Contorne pelo lado livre.');if(env.p<0.82&&G.mission===1&&Math.random()<0.6)strike();}
    }else if(f.state===1){
      f.t+=dt;const u=clamp(f.t/1.8,0,1);f.ang=f.angF*u*u;
      if(u>=1){f.state=2;f.ang=f.angF;SFX.crash();emitSpray(f.xb-f.side*f.len*0.8,0.2,f.z,30,6,8);if(Math.abs(P.z-f.z)<60)P.shake=Math.max(P.shake,0.8);}
    }
    f.g.rotation.z=f.side*f.ang;
    if(!playing||f.state===0||f.hitCD>0)continue;
    const sn=Math.sin(f.ang);if(sn<0.08)continue;
    const sdist=((f.xb-P.x)*f.side)/sn;
    if(sdist<0||sdist>f.len)continue;
    const yRel=(f.yb-lvl(f.z))+sdist*Math.cos(f.ang);
    if(yRel<2.4&&yRel>-1&&Math.abs(P.z-f.z)<1.4+(sdist>f.len-4?2.6:0)){
      f.hitCD=0.9;P.s=Math.min(P.s,4);P.z+=2.4;P.shake=Math.max(P.shake,1.2);P.stamina=Math.max(0,P.stamina-0.25);
      SFX.thud();toast('A árvore bloqueou o rio! Contorne pelo lado livre.');emitSpray(P.x,0.3,P.z,20,4,5);hurt(25);
    }
  }
}

/* Sucuri: cobra grande e brilhante que atravessa o rio de uma margem à outra */
const SN={active:false,N:34,mesh:null,head:null,tongue:null,x0:0,z:0,dir:1,speed:4.6,age:0,hitCD:0,next:99,pts:[]};
const snR=u=>u<0.12?lerp(0.22,0.44,u/0.12):u<0.55?0.46:lerp(0.46,0.06,(u-0.55)/0.45);
(function(){
  const mat=new THREE.MeshPhongMaterial({color:0xffffff,specular:0x667766,shininess:55}); // brilho de pele molhada
  SN.mesh=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,8),mat,SN.N);
  SN.mesh.frustumCulled=false;SN.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);SN.mesh.visible=false;scene.add(SN.mesh);
  for(let k=0;k<SN.N;k++){
    const bl=(k%5===1||k%5===2);                       // manchas escuras ao longo do dorso
    colTmp.setHSL(bl?0.1:0.2,bl?0.3:0.45,bl?0.045:0.14);SN.mesh.setColorAt(k,colTmp);
    SN.pts.push({x:0,z:0,r:0.3});
    dummy.position.set(0,-50,0);dummy.rotation.set(0,0,0);dummy.scale.set(0.1,0.1,0.1);dummy.updateMatrix();SN.mesh.setMatrixAt(k,dummy.matrix);
  }
  SN.mesh.instanceColor.needsUpdate=true;
  const skin=new THREE.MeshPhongMaterial({color:0x2d3a16,specular:0x556644,shininess:50});
  const hg=new THREE.Group();
  const skull=new THREE.Mesh(new THREE.SphereGeometry(1,12,10),skin);skull.scale.set(0.3,0.2,0.5);hg.add(skull);
  const snout=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),skin);snout.scale.set(0.2,0.14,0.3);snout.position.z=-0.42;hg.add(snout);
  for(const sx of[-1,1]){const eye=new THREE.Mesh(new THREE.SphereGeometry(0.055,8,6),new THREE.MeshBasicMaterial({color:0xffd23a}));eye.position.set(sx*0.2,0.1,-0.24);hg.add(eye);}
  SN.tongue=new THREE.Mesh(new THREE.BoxGeometry(0.03,0.012,0.32),new THREE.MeshBasicMaterial({color:0xd0263a}));SN.tongue.position.set(0,-0.02,-0.78);hg.add(SN.tongue);
  hg.scale.setScalar(1.3);hg.visible=false;scene.add(hg);SN.head=hg;
})();
function spawnSnake(){
  const z=P.z-150,hw=riverW(z)/2,side=Math.random()<0.5?-1:1;
  SN.active=true;SN.z=z;SN.dir=-side;SN.x0=riverC(z)+side*(hw+3);SN.age=0;SN.hitCD=0;SN.mesh.visible=true;SN.head.visible=true;
  SN.next=G.phase>=PH.TRILHA?rand(12,18):rand(16,24);
  toast('🐍 Sucuri cruzando o rio à frente!');SFX.hiss();
}
function resetSnake(){SN.active=false;SN.mesh.visible=false;SN.head.visible=false;SN.next=rand(9,13);}
function updateSnake(dt){
  if(G.state==='playing'&&G.phase>=PH.BANZEIRO&&!SN.active&&!(G.board&&G.board.active)){SN.next-=dt;if(SN.next<=0&&P.z-150>zEnd()+90)spawnSnake();}
  if(!SN.active)return;
  SN.age+=dt;
  const hx=SN.x0+SN.dir*SN.speed*SN.age,amp=waveAmp(),lv=lvl(SN.z);
  const wig=u=>0.5+1.2*u;
  const hz=SN.z+wig(0)*Math.sin(T*3.4);
  SN.head.position.set(hx,0.46+waveH(hx,hz,T,amp)*0.8+lv+0.04*Math.sin(T*2),hz);
  SN.head.rotation.set(0.12*Math.sin(T*2),-SN.dir*Math.PI/2,0);
  SN.tongue.visible=Math.sin(T*16)>0.2;
  for(let k=0;k<SN.N;k++){
    const u=k/(SN.N-1),x=hx-SN.dir*(0.55+k*0.5),z=SN.z+wig(u)*Math.sin(T*3.4-(k+1)*0.42),r=snR(u);
    const y=(u<0.1?0.3-u*1.5:0.02)+waveH(x,z,T,amp)*0.8+lv+0.03*Math.sin(T*2+k);
    const q=SN.pts[k];q.x=x;q.z=z;q.r=r;
    dummy.position.set(x,y,z);dummy.rotation.set(0,0,0);dummy.scale.set(r,r*0.9,r);dummy.updateMatrix();SN.mesh.setMatrixAt(k,dummy.matrix);
  }
  SN.mesh.instanceMatrix.needsUpdate=true;
  if(Math.random()<dt*8)emitSpray(hx,0.1,hz,1,1.2,1);
  const tailX=hx-SN.dir*(0.55+SN.N*0.5),far=riverC(SN.z)+SN.dir*(riverW(SN.z)/2+3);
  if((SN.dir>0?tailX>far:tailX<far)||SN.z>P.z+30){resetSnake();SN.next=rand(14,22);return;}
  SN.hitCD-=dt;
  if(G.state==='playing'&&SN.hitCD<=0){
    for(const q of SN.pts){
      if(Math.hypot(P.x-q.x,P.z-q.z)<q.r+1.0||Math.hypot(P.x-q.x,P.z+1.8-q.z)<q.r+0.8||Math.hypot(P.x-q.x,P.z-1.8-q.z)<q.r+0.8){
        SN.hitCD=1.4;P.s=Math.max(CFG.vMin*0.7,P.s*0.4);P.stamina=Math.max(0,P.stamina-0.3);P.shake=Math.max(P.shake,1.0);
        SFX.hiss();SFX.thud();emitSpray(P.x,0.3,P.z,20,4,5);toast('🐍 A sucuri te enroscou! Reme!');hurt(20);
        break;
      }
    }
  }
}

/* Redemoinhos: só na correnteza barrenta do Solimões */
const WH={slots:[0,1,2].map(()=>({x:0,z:1e6,r:1,active:false,cd:0})),front:0};
function resetWhirls(){for(const w of WH.slots){w.active=false;w.z=1e6;w.x=0;w.r=1;}WH.front=P.z-80;}
function whirlDip(x,z){let y=0;for(const w of WH.slots){if(!w.active)continue;y-=1.2*Math.exp(-((x-w.x)*(x-w.x)+(z-w.z)*(z-w.z))/(w.r*w.r*0.6));}return y;}
function updateWhirls(dt){
  const playing=G.state==='playing';
  if(playing&&G.phase===PH.ENCONTRO){
    const zStop=meetZ()[1]+30;
    while(WH.front>P.z-200){
      const z=WH.front-rand(60,90);WH.front=z;
      if(z<zStop)break;
      const w=WH.slots.find(q=>!q.active);if(!w)break;
      const hw=riverW(z)/2;
      w.active=true;w.z=z;w.r=rand(4.5,6.5);w.x=riverC(z)+bnd(z)+rand(5,hw-6);w.cd=0;
    }
  }
  for(const w of WH.slots){
    if(!w.active)continue;
    if(w.z>P.z+40){w.active=false;w.z=1e6;w.x=0;w.r=1;continue;}
    if(!playing)continue;
    const dx=w.x-P.x,dz=w.z-P.z,d=Math.hypot(dx,dz)+0.001,R=w.r*2.2;
    if(d<R){
      const k=1-d/R;
      P.vo+=(dx/d*16-dz/d*10)*k*dt;          // puxa para o centro e gira
      P.s=Math.max(P.s-14*k*dt,5);
      P.shake=Math.max(P.shake,0.3*k);P.kick=Math.max(P.kick,0.4*k);
      w.cd-=dt;
      if(d<w.r*0.5&&w.cd<=0){w.cd=2;P.s=Math.min(P.s,5);P.stamina=Math.max(0,P.stamina-0.2);SFX.whirl();toast('🌀 REDEMOINHO! Reme para escapar!');buzz(50);}
    }
  }
}

/* Banzeiro: ondas grandes que jogam a canoa de lado */
const BZ={state:0,t:0,next:99,ph:0,k:1};
function startBanzeiro(){
  BZ.state=1;BZ.t=0;BZ.ph=rand(0,6.28);BZ.k=G.phase>=PH.TRILHA?0.7:1;
  showBanner('BANZEIRO!','Segure firme — ondas vindo de lado');SFX.banzeiro();
}
function resetBanzeiro(){BZ.state=0;BZ.next=99;env.bz=0;}
function updateBanzeiro(dt){
  if(G.state==='playing'&&G.phase>=PH.BANZEIRO){
    if(BZ.state===0){BZ.next-=dt;if(BZ.next<=0)startBanzeiro();}
    else{BZ.t+=dt;if(BZ.t>8.2){BZ.state=0;BZ.next=G.phase>=PH.TRILHA?rand(20,28):rand(12,18);}}
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
  uniforms:{uTime:{value:0},uWind:{value:5},uSpeed:{value:30},uInt:{value:0.4},uBaseY:{value:-1},uCenter:{value:new THREE.Vector3()},uBox:{value:new THREE.Vector3(46,30,60)},uColor:{value:new THREE.Color(0xb8cad2)}},
  vertexShader:`attribute float aEnd;uniform float uTime,uWind,uSpeed,uInt,uBaseY;uniform vec3 uCenter,uBox;varying float vA;
  float h3(vec3 s){return fract(sin(dot(s,vec3(12.9898,78.233,37.719)))*43758.5453);}
  void main(){
    vec3 s=position;
    float fall=uSpeed*(0.8+0.4*h3(s.zyx));
    vec3 q=s*uBox;
    float y=mod(q.y-uTime*fall,uBox.y)+uBaseY;
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
    spray.pos.set([x+rand(-0.6,0.6),y+lvl(z),z+rand(-0.6,0.6)],i*3);
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
    if(spray.pos[k+1]<lvl(spray.pos[k+2])||spray.life[i]<=0){spray.life[i]=0;spray.pos[k+1]=-100;}
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
function groundY(side,z,d){const r=z/BANK_STEP,r0=Math.floor(r),f=r-r0;return lerp(bankRowY(r0,side,d),bankRowY(r0+1,side,d),f)+lvl(z);}
/* abre uma trilha na mata para a pessoa passar */
function clearCorridor(zc,side){
  const hit=(x,z)=>{const dx=(x-riverC(z))*side;return Math.abs(z-zc)<4.8&&dx>0&&(dx-riverW(z)/2)>-2.5&&(dx-riverW(z)/2)<I.d0+8;};
  for(let i=0;i<CFG.forestN;i++)if(hit(treeX[i],treeZ[i]))placeTree(i,treeZ[i]-SPAN);
  for(let i=0;i<CFG.bushN;i++)if(hit(bushX[i],bushZ[i]))placeBush(i,bushZ[i]-SPAN);
  for(let i=0;i<CFG.rockN;i++)if(hit(rockX[i],rockZ[i]))placeRock(i,rockZ[i]-SPAN);
  for(let i=0;i<CFG.logN;i++)if(hit(logX[i],logZ[i]))placeLog(i,logZ[i]-SPAN);
  for(let i=0;i<CFG.palmN;i++)if(hit(palmX[i],palmZ[i]))placePalm(i,palmZ[i]-SPAN);
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
  if(!I.c0&&t>0.9){I.c0=true;toast('Você é técnico de enfermagem da saúde ribeirinha e indígena.');}
  if(!I.c1&&t>4.6){I.c1=true;toast('Uma criança da Comunidade Boa Esperança está com febre alta.');}
  if(!I.c2&&t>8.6){I.c2=true;toast('O remédio só chega pelo rio. E um jacaré vigia a água…');}
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
  const cv=document.createElement('canvas');cv.width=512;cv.height=128;const cx=cv.getContext('2d');VIL.signCx=cx;
  cx.fillStyle='#4a3220';cx.fillRect(0,0,512,128);cx.strokeStyle='#2b1c10';cx.lineWidth=8;cx.strokeRect(4,4,504,120);
  cx.fillStyle='#f0d27a';cx.font='bold 38px Georgia,serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText('VILA BOA ESPERANÇA',256,66);
  VIL.sign=new THREE.Mesh(new THREE.PlaneGeometry(3.6,0.9),new THREE.MeshBasicMaterial({map:(VIL.signTex=new THREE.CanvasTexture(cv)),side:THREE.DoubleSide}));VIL.g.add(VIL.sign);
  VIL.signPosts=[0,1].map(()=>{const p=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.08,2.8,6),new THREE.MeshLambertMaterial({color:0x3b2a1a}));VIL.g.add(p);return p;});
  VIL.g.add(VIL.fig.g);
  // maloca (aldeia) e prédio do Polo Base
  const thatch=new THREE.MeshLambertMaterial({color:0x7a5a2a}),wall=new THREE.MeshLambertMaterial({color:0x8a6a44});
  VIL.maloca=new THREE.Group();
  const mb=new THREE.Mesh(new THREE.CylinderGeometry(4,4.2,2.6,12),wall);mb.position.y=1.3;
  const mr=new THREE.Mesh(new THREE.ConeGeometry(5.6,3.6,12),thatch);mr.position.y=4.4;
  VIL.maloca.add(mb,mr);VIL.maloca.visible=false;VIL.g.add(VIL.maloca);
  VIL.polo=new THREE.Group();
  const pb=new THREE.Mesh(new THREE.BoxGeometry(9,3.4,6),new THREE.MeshLambertMaterial({color:0xe8e4dc,emissive:0x1a1814}));pb.position.y=1.7;
  const pr=new THREE.Mesh(new THREE.BoxGeometry(9.6,0.4,6.6),new THREE.MeshLambertMaterial({color:0xb23a2f}));pr.position.y=3.6;
  const redM=new THREE.MeshBasicMaterial({color:0xd0352b});
  const c1=new THREE.Mesh(new THREE.BoxGeometry(1.6,0.45,0.05),redM),c2=new THREE.Mesh(new THREE.BoxGeometry(0.45,1.6,0.05),redM);
  c1.position.set(0,2.3,3.05);c2.position.set(0,2.3,3.05);
  const wd=new THREE.Mesh(new THREE.BoxGeometry(1.2,1.0,0.05),vGlow);wd.position.set(3,1.8,3.05);
  VIL.polo.add(pb,pr,c1,c2,wd);VIL.polo.visible=false;VIL.g.add(VIL.polo);
})();
function setSign(text){
  const cx=VIL.signCx;if(!cx)return;
  cx.fillStyle='#4a3220';cx.fillRect(0,0,512,128);cx.strokeStyle='#2b1c10';cx.lineWidth=8;cx.strokeRect(4,4,504,120);
  cx.fillStyle='#f0d27a';cx.font='bold '+(text.length>20?30:38)+'px Georgia,serif';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(text,256,66);
  if(VIL.signTex)VIL.signTex.needsUpdate=true;
}
function vput(mesh,i,x,y,z,sy,h,sat,l){
  dummy.position.set(x,y,z);dummy.rotation.set(0,0,0);dummy.scale.set(1,sy,1);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
  if(h!==undefined){colTmp.setHSL(h,sat,l);mesh.setColorAt(i,colTmp);}
}
function placeVillage(zc,kind){
  kind=kind||(G.mission===2?'aldeia':'vila');
  const ze=zc===undefined?(kind==='aldeia'?zAld():zEnd()):zc;
  VIL.zc=ze;
  setSign(kind==='aldeia'?'ALDEIA MARIPÁ':kind==='polo'?'POLO BASE · SAÚDE INDÍGENA':'COMUNIDADE BOA ESPERANÇA');
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
  VIL.zp=zp;VIL.endX=cp+hwp-8.5;const L0=lvl(zp);
  VIL.pier.position.set(cp+hwp-3,0.65+L0,zp);
  let pi=0,li=0;
  for(const dx of[-8.6,-5.5,-2.5,0.4])for(const sz of[-1.1,1.1])vput(VH.post,pi++,cp+hwp+dx,0.2+L0,zp+sz,1,0.07,0.25,0.12);
  for(const dx of[-8.6,-4.5,0.4])for(const sz of[-1.1,1.1])vput(VH.lamp,li++,cp+hwp+dx,1.25+L0,zp+sz,1);
  const zs=ze+8,xs=riverC(zs)+riverW(zs)/2+3.2;
  VIL.sign.position.set(xs,2.6+L0,zs);
  VIL.signPosts[0].position.set(xs-1.7,1.4+L0,zs);VIL.signPosts[1].position.set(xs+1.7,1.4+L0,zs);
  VIL.fig.g.position.set(VIL.endX,0.72+L0,zp);VIL.fig.g.rotation.y=Math.PI/2;
  VIL.light.position.set(VIL.endX,2.4+L0,zp);
  VIL.maloca.visible=kind==='aldeia';VIL.polo.visible=kind==='polo';
  const zm=ze-10;VIL.maloca.position.set(riverC(zm)+riverW(zm)/2+22,groundY(1,zm,22),zm);
  const zq=ze+2;VIL.polo.position.set(riverC(zq)+riverW(zq)/2+18,groundY(1,zq,18),zq);VIL.polo.rotation.y=-Math.PI/2; // fachada para o rio
  for(const m of Object.values(VH)){m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;}
}
function updateVillage(){
  VIL.g.visible=G.state!=='menu';
  VIL.light.intensity=G.state==='menu'?0:(1-smooth((Math.abs(P.z-VIL.zc)-60)/200))*1.8;
  VIL.fig.parts.armR.rotation.z=2.6+Math.sin(T*7)*0.35;
}
placeVillage();
function setRunOrigin(forMenu){
  RUN_Z0=P.z;bankBase=null;
  LEDGES=(forMenu||G.mission===2)?[]:[RUN_Z0-COURSE.L*0.47,RUN_Z0-COURSE.L*0.54];
  LD=LEDGES.map(()=>({warned:false,hit:false,done:false}));
  if(worldDirty){rebuildForest();worldDirty=false;}
  placeLedgeRocks();placeVillage();
}

/* ===== Missão 2: buscar a paciente na aldeia e levá-la ao Polo Base ===== */
const dockM=new THREE.Mesh(new THREE.TorusGeometry(3.2,0.18,8,28),new THREE.MeshBasicMaterial({color:0xffd24a,transparent:true,opacity:0.9}));
dockM.rotation.x=Math.PI/2;dockM.visible=false;scene.add(dockM);
const PT=makeFigure(0xbcd0e0,'patient');PT.g.visible=false;scene.add(PT.g);         // paciente caminhando até a canoa
const SEAT=makeFigure(0xbcd0e0,'patient');                                          // paciente sentada na canoa
SEAT.g.position.set(0,-0.55,-0.85);SEAT.parts.legL.rotation.x=1.5;SEAT.parts.legR.rotation.x=1.5;
SEAT.parts.armL.rotation.x=-0.7;SEAT.parts.armR.rotation.x=-0.7;SEAT.g.visible=false;canoeG.add(SEAT.g);
const dockZ=()=>zAld()-14;
function startBoarding(){G.board={active:true,t:0};PT.g.visible=true;toast('A paciente está a caminho da canoa…');}
function updateDock(dt){
  const act=G.state==='playing'&&G.mission===2&&!G.patient;
  dockM.visible=act;
  if(!act)return;
  const zd=dockZ(),ot=riverW(zd)/2-12,D_=G.dock;
  dockM.position.set(riverC(zd)+ot,lvl(zd)+0.15+0.05*Math.sin(T*3),zd);
  const dz=P.z-zd,lat=Math.abs(P.o-ot);
  if(!D_.warned&&dz<140){D_.warned=true;showBanner('ALDEIA MARIPÁ','Segure S para reduzir e fique dentro do círculo dourado, ao lado do píer','A anciã aguarda o transporte até o Polo Base.');}
  if(G.board&&G.board.active)return;
  if(Math.abs(dz)<12&&lat<5&&P.s<9){D_.t+=dt;if(D_.t>0.9)startBoarding();}else D_.t=Math.max(0,D_.t-dt);
  if(dz<-45){ // passou direto do píer: volta um trecho para tentar de novo
    D_.missed++;toast('Você passou do píer! Voltando para tentar de novo.');
    P.z=zd+130;P.s=Math.min(P.s,12);P.o=0;P.vo=0;resetObstacles(true);hurt(8);
  }
}
function updateBoarding(dt){
  const B=G.board;if(!B||!B.active)return;
  B.t+=dt;canoeG.updateMatrixWorld(true);
  const zp=VIL.zp,y0=0.72+lvl(zp);
  if(B.t<3){
    const u=B.t/3;
    PT.g.position.set(VIL.endX+lerp(7,0.6,u),y0,zp+0.4);PT.g.rotation.y=Math.PI/2;
    const a=Math.sin(B.t*8);PT.parts.legL.rotation.x=a*0.7;PT.parts.legR.rotation.x=-a*0.7;PT.parts.armL.rotation.x=-a*0.4;PT.parts.armR.rotation.x=a*0.4;
    if(Math.floor(B.t*8/Math.PI)!==Math.floor((B.t-dt)*8/Math.PI))SFX.step();
  }else if(B.t<4.2){
    const u=smooth((B.t-3)/1.2);vSeat.set(0,0.2,-0.85);canoeG.localToWorld(vSeat);
    PT.g.position.set(lerp(VIL.endX+0.6,vSeat.x,u),lerp(y0,vSeat.y,u)+Math.sin(Math.PI*u)*0.5,lerp(zp+0.4,vSeat.z,u));
    PT.g.rotation.y=lerp(Math.PI/2,P.yaw,u);
    PT.parts.legL.rotation.x=0.9*Math.sin(Math.PI*u);PT.parts.legR.rotation.x=-0.4*Math.sin(Math.PI*u);
  }else{
    PT.g.visible=false;SEAT.g.visible=true;B.active=false;G.patient=true;G.phase=PH.POLO;P.kick=1;SFX.board();
    C.emerged=false;C.D=CFG.startGap+15;                 // o jacaré volta a seguir a canoa
    toast('Paciente a bordo! Rumo ao Polo Base.');
    showBanner('FASE 9 — '+COURSE.names[PH.POLO],COURSE.subs[PH.POLO],COURSE.story[PH.POLO]);SFX.sting();
  }
}
function updateMission2(){
  if(G.mission!==2)return;
  if(G.patient&&!G.poloPlaced&&P.z<zAld()-260){G.poloPlaced=true;placeVillage(zEnd(),'polo');}  // o Polo Base aparece à frente
}
function startMission2(){
  hide($('end'));hide($('btnNext'));
  G.mission=2;COURSE.L=COURSE.L2;G.phase=PH.BUSCA;G.patient=false;G.poloPlaced=false;G.board=null;G.dock={t:0,warned:false,missed:0};
  G.near=false;G.endDelay=0;G.cause='croc';
  SEAT.g.visible=false;PT.g.visible=false;
  P.hp=Math.min(100,P.hp+40);P.stamina=1;P.exhausted=false;P.hitCD=0;P.inv=0;P.shake=0;P.kick=0;P.s=0;P.vo=0;
  Object.assign(C,{D:CFG.startGap,o:0,surf:0,surfTarget:0,emerged:false,diving:false,diveT:0,nextDive:rand(14,20),nextSurge:rand(10,15),surgeT:0,beatT:0});
  env.danger=0;L.ft=99;
  resetSnake();resetBanzeiro();resetTrees();resetWhirls();
  BZ.next=14;SN.next=rand(12,18);FT.next=30;
  worldDirty=true;setRunOrigin(false);          // reconstrói margens e floresta para o novo trecho
  camX=riverC(P.z);camY=3.1;
  resetObstacles(true);
  G.state='playing';vignEl.style.opacity=0;
  fadeEl.style.transition='none';fadeEl.style.opacity=1;void fadeEl.offsetWidth;fadeEl.style.transition='opacity 1.8s ease';fadeEl.style.opacity=0;
  setUI();
  showBanner('MISSÃO 2 — '+COURSE.names[PH.BUSCA],COURSE.subs[PH.BUSCA],COURSE.story[PH.BUSCA]);
}

/* Névoa baixa: camadas de bruma que deslizam sobre a água (mais forte no igapó) */
const MIST=[];
(function(){
  for(let i=0;i<3;i++){
    const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,fog:false,
      uniforms:{uTime:{value:0},uCol:{value:new THREE.Color(CFG.fog)},uAmt:{value:0.3},uOff:{value:new THREE.Vector2(i*37.1,i*11.7)}},
      vertexShader:`varying vec2 vW;varying vec3 vP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vW=wp.xz;vP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
      fragmentShader:`uniform float uTime,uAmt;uniform vec3 uCol;uniform vec2 uOff;varying vec2 vW;varying vec3 vP;
        ${NOISE_GLSL}
        float fbm3(vec2 p){float a=0.5,s=0.0;for(int i=0;i<3;i++){s+=a*vnoise(p);p*=2.03;a*=0.5;}return s;}
        void main(){
          float n=fbm3(vW*0.035+uOff+vec2(uTime*0.02,uTime*0.013));
          float d=length(cameraPosition-vP);
          float fade=smoothstep(4.0,25.0,d)*(1.0-smoothstep(120.0,240.0,d));
          gl_FragColor=vec4(uCol,smoothstep(0.35,0.75,n)*uAmt*fade);
        }`});
    const g=new THREE.PlaneGeometry(420,420,1,1);g.rotateX(-Math.PI/2);
    const m=new THREE.Mesh(g,mat);m.frustumCulled=false;m.renderOrder=1;m.visible=false;scene.add(m);MIST.push(m);
  }
})();
function updateMist(){
  const base=lvl(P.z),amt=0.2+0.5*env.ig+0.1*env.rain+0.3*(G.mission===2?Math.max(0,1-env.p*2):0);
  for(let i=0;i<MIST.length;i++){
    const m=MIST[i];m.visible=i<QF[quality].mist;if(!m.visible)continue;
    m.position.set(P.x,base+0.5+i*1.3,P.z);
    const u=m.material.uniforms;u.uTime.value=T;u.uCol.value.copy(fogTmp).multiplyScalar(1.25);u.uAmt.value=amt*(1-0.25*i);
  }
}

/* Vaga-lumes (só de noite) */
const FF={n:MOBILE?90:160,pts:null,geo:null,mat:null,seed:[]};
(function(){
  const pos=new Float32Array(FF.n*3);
  for(let i=0;i<FF.n;i++)FF.seed.push({a:Math.random(),b:Math.random(),c:Math.random(),side:Math.random()<0.5?-1:1});
  FF.geo=new THREE.BufferGeometry();FF.geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  FF.mat=new THREE.PointsMaterial({color:0xd8ff7a,size:0.45,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  FF.pts=new THREE.Points(FF.geo,FF.mat);FF.pts.frustumCulled=false;FF.pts.visible=false;scene.add(FF.pts);
})();
function updateFireflies(){
  const op=clamp((1-env.dl)*(1-0.5*env.rain)*1.1,0,0.9)*(0.75+0.25*Math.sin(T*5));
  FF.mat.opacity=op;FF.pts.visible=op>0.03;
  if(!FF.pts.visible)return;
  const pos=FF.geo.attributes.position.array,cz=P.z+40,nUse=Math.floor(FF.n*QF[quality].ff);
  FF.geo.setDrawRange(0,nUse);
  for(let i=0;i<nUse;i++){
    const s=FF.seed[i],z=s.a*200+200*Math.floor((cz-s.a*200)/200);
    pos[i*3]=riverC(z)+s.side*(riverW(z)/2+0.5+s.b*14)+Math.sin(T*0.7+s.a*20)*1.2;
    pos[i*3+1]=lvl(z)+1.0+s.c*3.5+Math.sin(T*1.1+s.b*30)*0.5;
    pos[i*3+2]=z;
  }
  FF.geo.attributes.position.needsUpdate=true;
}

/* ============================================================
   LIGHTNING
   ============================================================ */
const L={next:5,ft:99,rumble:10},THUNDER=[];
const bolt=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,1,0)]),new THREE.LineBasicMaterial({color:0xdfe9ff,fog:false,transparent:true}));
bolt.visible=false;bolt.frustumCulled=false;scene.add(bolt);
const flashLevel=ft=>{if(ft<0||ft>1.4)return 0;let v=Math.exp(-ft*10);if(ft>0.16)v=Math.max(v,0.8*Math.exp(-(ft-0.16)*7));return v;};
function strike(){
  L.ft=0;
  const near=Math.random()<0.3;
  const pts=[];let x=P.x+rand(near?-60:-140,near?60:140),y=170,z=P.z-rand(near?60:120,near?110:260);
  for(let i=0;i<=16;i++){pts.push(new THREE.Vector3(x,y,z));y-=168/16;x+=rand(-9,9);z+=rand(-5,5);}
  bolt.geometry.setFromPoints(pts);
  const delay=near?rand(0.1,0.45):rand(0.6,3.0),pw=clamp(1-delay/3.2,0.15,1);
  SFX.thunder(delay,pw);THUNDER.push({t:T+delay,pw});
}
function updateLightning(dt){
  const st=G.state;
  if(st==='menu'||st==='intro'||(st==='playing'&&G.t>20&&env.p<0.82&&G.mission===1)||(st==='lost'&&env.p<0.82&&G.mission===1)){
    L.next-=dt;
    if(L.next<=0){strike();L.next=(st==='menu'||st==='intro')?rand(9,15):lerp(14,8,smooth(G.t/80))*rand(0.8,1.25)*(G.phase===PH.MATA?0.6:1);}
  }
  for(let i=THUNDER.length-1;i>=0;i--)if(T>=THUNDER[i].t){const q=THUNDER[i];P.shake=Math.max(P.shake,0.35*q.pw);buzz(Math.round(40*q.pw));THUNDER.splice(i,1);}
  L.rumble-=dt;if(L.rumble<=0){L.rumble=rand(14,26);if(env.rain>0.6&&st==='playing')SFX.thunder(0,0.22);}
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
    G_.roar=gain(0);loop(b).connect(filt('lowpass',700)).connect(G_.roar);G_.roar.connect(this.master);
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
  update(rain,sp,danger,dt,bz,fall){
    if(!this.ctx)return;
    this.set('rain',0.03+0.17*rain);this.set('rainLow',0.04+0.12*rain);
    this.set('water',0.1+0.16*sp);this.set('rush',0.005+0.08*sp*sp);
    this.set('wind',0.03+0.1*rain+0.06*sp+0.12*(bz||0));this.set('ins',0.015+0.02*(1-rain));
    this.set('danger',0.17*danger);this.set('roar',0.5*(fall||0));
    this.chirpT-=dt;if(this.chirpT<=0){this.chirpT=rand(3,8);if(rain<0.7&&Math.random()<0.7)this.chirp();}
    this.frogT-=dt;if(this.frogT<=0){this.frogT=rand(4,9);this.frog();}
  },
  burst(o){
    if(!this.ctx)return;const c=this.ctx,t0=c.currentTime+(o.delay||0),dur=o.dur||0.4;
    const s=c.createBufferSource();s.buffer=this.nb[o.buf||'white'];
    const f=c.createBiquadFilter();f.type=o.type||'lowpass';f.Q.value=o.q||0.7;
    f.frequency.setValueAtTime(o.f0||800,t0);f.frequency.exponentialRampToValueAtTime(Math.max(20,o.f1||200),t0+dur);
    const g=c.createGain();g.gain.setValueAtTime(0.0001,t0);g.gain.linearRampToValueAtTime(o.vol||0.3,t0+(o.attack||0.01));g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    s.connect(f);f.connect(g);
    if(o.pan!==undefined&&c.createStereoPanner){const pn=c.createStereoPanner();pn.pan.value=Math.max(-1,Math.min(1,o.pan));g.connect(pn);pn.connect(this.master);}else g.connect(this.master);
    s.start(t0,Math.random()*2);s.stop(t0+dur+0.05);
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
  whirl(){this.burst({type:'bandpass',f0:300,f1:1400,dur:1.2,vol:0.25,q:2,buf:'brown'});},
  pickup(){this.tone('sine',660,990,0.18,0.18);this.tone('sine',990,1320,0.2,0.14,0.08);buzz(15);},
  creak(){this.tone('sawtooth',90,60,1.2,0.14);this.tone('sawtooth',130,80,1.0,0.08,0.3);this.burst({type:'bandpass',f0:600,f1:200,dur:1.4,vol:0.12,q:2});},
  crash(){this.burst({f0:1200,f1:80,dur:1.6,vol:0.9,buf:'brown',attack:0.02});this.splash(1);this.tone('sine',70,30,0.8,0.6);buzz(120);},
  step(){this.burst({f0:700,f1:180,dur:0.14,vol:0.11});},
  board(){this.tone('sine',130,60,0.25,0.35);this.splash(0.4);},
  paddle(v){this.burst({f0:1300,f1:300,dur:0.35,vol:0.05+0.1*v});},
  splash(v){this.burst({type:'bandpass',f0:2600,f1:600,dur:0.55,vol:0.35*v,q:0.8});this.burst({f0:500,f1:120,dur:0.5,vol:0.4*v,buf:'brown'});},
  thud(){buzz(40);this.tone('sine',110,40,0.3,0.6);this.burst({f0:900,f1:150,dur:0.35,vol:0.5});this.splash(0.6);},
  crunch(){buzz([120,60,160]);this.tone('sine',90,30,0.7,0.8);this.burst({f0:3000,f1:200,dur:0.7,vol:0.7});this.splash(1);this.growl();},
  thunder(delay,pw){
    if(!this.ctx)return;pw=pw===undefined?0.6:pw;
    const pan=rand(-0.8,0.8);
    if(pw>0.55){ // estalo seco + pancada grave (raio perto)
      this.burst({type:'highpass',f0:5000,f1:900,dur:0.22,vol:0.5*pw,delay,pan,attack:0.003});
      this.tone('sine',60,28,0.9,0.55*pw,delay+0.02);
    }
    this.burst({f0:500*(0.5+pw),f1:50,dur:2.2+3*pw,vol:0.5+0.6*pw,attack:0.08+0.15*(1-pw),buf:'brown',delay:delay+0.04,pan});
    const n=3+Math.floor(pw*3);          // ecos rolando pelo céu
    for(let i=0;i<n;i++)this.burst({f0:rand(250,420),f1:45,dur:rand(1.2,2.4),vol:(0.3+0.3*pw)*rand(0.5,1),attack:rand(0.1,0.3),buf:'brown',delay:delay+0.6+i*rand(0.35,0.8),pan:pan+rand(-0.3,0.3)});
  },
  alert(){this.tone('square',880,860,0.14,0.1);this.tone('square',620,600,0.16,0.1,0.17);},
  beat(k){buzz(18);this.tone('sine',75,38,0.16,0.55*k);this.tone('sine',70,36,0.16,0.4*k,0.19);},
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
/* Toque: joystick analógico, botões grandes, remada automática, inclinação e tela cheia */
const tilt={on:false,axis:0};
let autoPaddle=IS_TOUCH,autoHold=true,stickId=null;
const stickEl=$('stick'),knobEl=$('knob');
function stickMove(e){
  const r=stickEl.getBoundingClientRect(),rad=r.width/2;
  const dx=clamp((e.clientX-(r.left+rad))/rad,-1,1);
  tc.axis=Math.abs(dx)<0.1?0:dx;knobEl.style.transform='translateX('+(dx*rad*0.55)+'px)';
}
stickEl.addEventListener('pointerdown',e=>{e.preventDefault();stickId=e.pointerId;try{stickEl.setPointerCapture(e.pointerId);}catch(_){}stickMove(e);});
stickEl.addEventListener('pointermove',e=>{if(e.pointerId===stickId){e.preventDefault();stickMove(e);}});
const stickEnd=e=>{if(e.pointerId===stickId){stickId=null;tc.axis=0;knobEl.style.transform='translateX(0)';}};
['pointerup','pointercancel','lostpointercapture'].forEach(ev=>stickEl.addEventListener(ev,stickEnd));
document.querySelectorAll('#tbtns [data-k]').forEach(b=>{
  const k=b.dataset.k;
  const on=e=>{e.preventDefault();tc[k]=true;b.classList.add('d');};
  const off=e=>{e.preventDefault();tc[k]=false;b.classList.remove('d');};
  b.addEventListener('pointerdown',on);['pointerup','pointercancel','pointerleave'].forEach(ev=>b.addEventListener(ev,off));
});
function tiltHandler(e){
  const ang=(window.screen&&window.screen.orientation&&window.screen.orientation.angle)||window.orientation||0;
  const a=ang===90?e.beta:(ang===-90||ang===270)?-e.beta:e.gamma;
  tilt.axis=clamp((a||0)/22,-1,1);
}
async function toggleTilt(){
  if(!tilt.on){
    try{
      if(typeof DeviceOrientationEvent!=='undefined'&&DeviceOrientationEvent.requestPermission){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted')return;}
      addEventListener('deviceorientation',tiltHandler);tilt.on=true;
    }catch(e){return;}
  }else{removeEventListener('deviceorientation',tiltHandler);tilt.on=false;tilt.axis=0;}
  syncOpts();
}
function toggleFull(){
  const d=document,el=d.documentElement;
  if(!d.fullscreenElement&&!d.webkitFullscreenElement){
    (el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el);
    try{const o=window.screen&&window.screen.orientation;if(o&&o.lock)o.lock('landscape').catch(()=>{});}catch(e){}
  }else (d.exitFullscreen||d.webkitExitFullscreen||function(){}).call(d);
}
function cycleQuality(){
  quality=QL[(QL.indexOf(quality)+1)%QL.length];
  try{localStorage.setItem('fugaAmazonas.q',quality);}catch(e){}
  PERF.pr=Math.min(window.devicePixelRatio||1,QF[quality].pr);renderer.setPixelRatio(PERF.pr);renderer.setSize(innerWidth,innerHeight);
  syncOpts();
}
function syncOpts(){
  document.querySelectorAll('.m-gfx').forEach(b=>b.textContent='Gráficos: '+({high:'ALTO',med:'MÉDIO',low:'BAIXO'})[quality]);
  document.querySelectorAll('.m-auto').forEach(b=>b.textContent='Remada automática: '+(autoPaddle?'LIGADA':'desligada'));
  document.querySelectorAll('.m-tilt').forEach(b=>b.textContent='Inclinar para virar: '+(tilt.on?'LIGADO':'desligado'));
  $('tUp').classList.toggle('hidden',autoPaddle);
}
document.querySelectorAll('.m-auto').forEach(b=>b.onclick=()=>{autoPaddle=!autoPaddle;syncOpts();});
document.querySelectorAll('.m-tilt').forEach(b=>b.onclick=toggleTilt);
document.querySelectorAll('.m-full').forEach(b=>b.onclick=toggleFull);
document.querySelectorAll('.m-gfx').forEach(b=>b.onclick=cycleQuality);

/* ============================================================
   UI
   ============================================================ */
const banEl=$('banner');
function showBanner(t,sub,story){
  $('banTitle').textContent=t;$('banSub').textContent=sub||'';$('banStory').textContent=story||'';
  banEl.classList.remove('on');void banEl.offsetWidth;banEl.classList.add('on');
}
const hudEl=$('hud'),barsEl=$('bars'),dangerEl=$('danger'),toastEl=$('toast'),mirrorEl=$('mirror'),vignEl=$('vignette');
const show=el=>el.classList.remove('hidden'),hide=el=>el.classList.add('hidden');
let toastTimer=0,hudTimer=0,mirrorRect={x:0,y:0,w:10,h:10};
const bar=(v,n=10)=>{const k=Math.round(clamp(v,0,1)*n);return '█'.repeat(k)+'░'.repeat(n-k);};
function toast(msg){toastEl.textContent=msg;toastEl.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.remove('on'),3200);}
function updateHUD(dt){
  hudTimer-=dt;if(hudTimer>0)return;hudTimer=0.1;
  const near=env.danger>0.15,tired=P.exhausted,pct=Math.round(env.p*100);
  const mzv=meetW(P.z),kv=laneK(P.z,P.o),lane=mzv>0.3?'\nCorrente: '+(kv>0.3?'SOLIMÕES (rápida)':kv<-0.3?'RIO NEGRO (lenta)':'ENCONTRO'):'';
  const obj=G.mission===1?'entregar o remédio':(G.patient?'levar a paciente ao Polo':'buscar a paciente');
  $('hudPhase').textContent='FASE '+(G.phase+1)+'/9 · '+COURSE.names[G.phase];
  barsEl.innerHTML='Missão '+G.mission+': '+obj+'\n'+
    'Vida: <span class="'+(P.hp<30?'warn':'')+'">'+bar(P.hp/100)+'</span> '+Math.round(P.hp)+'%\n'+
    'Velocidade: '+bar(P.s/CFG.vMax)+'\n'+
    'Distância do jacaré: <span class="'+(near?'warn':'')+'">'+bar(C.D/100)+'</span>\n'+
    'Fôlego: <span class="'+(tired?'tired':'')+'">'+bar(P.stamina)+(tired?' ⚠':'')+'</span>\n'+
    'Percurso: '+bar(env.p)+' '+pct+'%\n'+
    'Pontos: '+calcScore(false)+'  🫐 '+G.acai+'\n'+
    'Hora: '+timeLabel(env.p)+lane;
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
  const e=$('end');hide($('btnNext'));e.className='overlay '+(win?'win':'lose');
  $('endTitle').textContent=win?'MISSÃO CUMPRIDA!':(G.cause==='wreck'?'A CANOA NAUFRAGOU!':'O JACARÉ TE PEGOU!');
  $('endSub').textContent=win
    ?'Você levou a anciã da Aldeia Maripá ao Polo Base, onde a equipe médica a avaliou a tempo. Duas missões, um só rio — as comunidades contam com você.'
    :'Você caiu na fase '+(G.phase+1)+' ('+COURSE.names[G.phase]+'), a '+Math.round(G.endP*100)+'% do caminho, após '+fmt(G.t)+'. '+(G.cause==='wreck'?'A canoa não resistiu às batidas.':'O jacaré alcançou a canoa.')+' Tente de novo.';
  const p=Store.cur();
  $('endScore').textContent=G.finalScore+' pontos'+(G.newBest?' — novo recorde!':'')+(p?' · '+p.name:' (sem perfil: pontos não salvos)');
  show(e);
}
function togglePause(){
  if(G.state==='playing'){G.state='paused';SFX.suspend();setUI();}
  else if(G.state==='paused'){G.state='playing';SFX.resume();setUI();}
}
const goStart=()=>{SFX.init();beginIntro();};
$('btnStart').onclick=()=>{SFX.init();if(!Store.cur())showLogin(goStart);else goStart();};
$('btnSwitch').onclick=()=>showLogin(null);
$('btnLogin').onclick=()=>doLogin($('playerName').value);
$('btnGuest').onclick=()=>doLogin('Visitante');
$('btnLoginCancel').onclick=()=>{hide($('login'));afterLogin=null;};
$('btnRank').onclick=showRank;
$('btnNext').onclick=startMission2;
$('btnRankClose').onclick=()=>hide($('rank'));
['keydown','keyup'].forEach(ev=>$('playerName').addEventListener(ev,e=>{e.stopPropagation();if(ev==='keydown'&&(e.key==='Enter'||e.code==='Enter'))doLogin($('playerName').value);}));
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
function saveScore(){}
/* Perfis locais: nome + ID gerado neste aparelho. Para ranking online, troque Store.submit por uma chamada a um servidor. */
const Store={
  key:'fugaAmazonas.v2',data:{profiles:{},current:null},
  load(){try{const d=JSON.parse(localStorage.getItem(this.key));if(d&&d.profiles)this.data=d;}catch(e){}},
  save(){try{localStorage.setItem(this.key,JSON.stringify(this.data));}catch(e){}},
  uid(){try{if(crypto&&crypto.randomUUID)return crypto.randomUUID().slice(0,8);}catch(e){}return Math.random().toString(36).slice(2,10);},
  clean(n){return String(n||'').replace(/[^\p{L}\p{N} _.-]/gu,'').trim().slice(0,16)||'Visitante';},
  login(name){
    name=this.clean(name);const k=name.toLowerCase();
    let p=Object.values(this.data.profiles).find(q=>q.name.toLowerCase()===k);
    if(!p){p={id:this.uid(),name,created:Date.now(),runs:0,best:null,last:null};this.data.profiles[p.id]=p;}
    this.data.current=p.id;this.save();return p;
  },
  cur(){return this.data.profiles[this.data.current]||null;},
  list(){return Object.values(this.data.profiles).sort((a,b)=>((b.last&&b.last.date)||0)-((a.last&&a.last.date)||0));},
  submit(e,partial){const p=this.cur();if(!p)return false;if(!partial)p.runs++;p.last=e;const nb=!p.best||e.score>p.best.score;if(nb)p.best=e;this.save();return nb;},
  ranking(){return Object.values(this.data.profiles).filter(p=>p.best).sort((a,b)=>b.best.score-a.best.score).slice(0,10);}
};
Store.load();
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function overallP(){return G.mission===2?(COURSE.L1+clamp(env.p,0,1)*COURSE.L2)/(COURSE.L1+COURSE.L2):env.p*COURSE.L1/(COURSE.L1+COURSE.L2);}
function calcScore(final){const dist=(G.mission===2?COURSE.L1:0)+clamp(RUN_Z0-P.z,0,COURSE.L);return Math.round(dist+G.acai*50+(G.m1done?1000:0)+(final?1500+Math.max(0,480-G.t)*5:0));}
let afterLogin=null;
function renderPlayer(){const p=Store.cur();$('pName').textContent=p?p.name:'—';$('pId').textContent=p?'#'+p.id:'';}
function showLogin(cb){
  afterLogin=cb||null;
  $('chips').innerHTML=Store.list().slice(0,6).map(p=>'<button class="chip" data-n="'+esc(p.name)+'">'+esc(p.name)+'</button>').join('');
  $('chips').querySelectorAll('.chip').forEach(b=>b.onclick=()=>doLogin(b.dataset.n));
  $('playerName').value=(Store.cur()&&Store.cur().name)||'';
  show($('login'));setTimeout(()=>{try{$('playerName').focus();}catch(e){}},50);
}
function doLogin(name){
  Store.login(name);hide($('login'));renderPlayer();renderScore();
  const cb=afterLogin;afterLogin=null;if(cb)cb();
}
function showRank(){
  const cur=Store.cur(),rows=Store.ranking();
  $('rankBody').innerHTML=rows.length?'<table><tr><th>#</th><th>Jogador</th><th>Pontos</th><th>Resultado</th></tr>'+rows.map((p,i)=>
    '<tr class="'+(cur&&cur.id===p.id?'me':'')+'"><td>'+(i+1)+'</td><td>'+esc(p.name)+'</td><td>'+p.best.score+'</td><td>'+(p.best.won?'Chegou à vila':'Fase '+(p.best.phase+1)+' · '+Math.round(p.best.progress*100)+'%')+'</td></tr>').join('')+'</table>'
    :'<p class="hint">Ninguém pontuou ainda. Seja o primeiro!</p>';
  show($('rank'));
}
function renderScore(){
  const p=Store.cur(),l=p&&p.last,b=p&&p.best,box=$('lastScore');
  box.classList.toggle('win',!!(l&&l.won));box.classList.toggle('lose',!!(l&&!l.won));
  $('scoreVal').textContent=l?l.score+' pts':'--';
  $('scoreNote').textContent=!p?'Entre com seu nome para salvar seus pontos':!l?'Ainda sem registro':(l.won?'Chegou à vila! ':'Parou a '+Math.round(l.progress*100)+'% · ')+fmt(l.time)+' · 🫐 '+(l.acai||0);
  $('bestNote').textContent=b?'Melhor: '+b.score+' pts':'';
}
function toMenu(){
  resetRun();endIntroVisuals();
  G.state='menu';P.o=0;P.vo=0;P.s=14;camX=riverC(P.z);camY=3.1;
  setRunOrigin(true);
  resetObstacles(false);renderScore();setUI();
}
function resetRun(){
  G.mission=1;COURSE.L=COURSE.L1;G.patient=false;G.m1done=false;G.board=null;G.cause='croc';G.lostT=0;G.poloPlaced=false;G.dock={t:0,warned:false,missed:0};
  P.hp=100;P.inv=0;P.hurtT=0;SEAT.g.visible=false;PT.g.visible=false;
  SFX.resume();
  G.t=0;G.endDelay=0;G.evt=0;G.phase=0;G.near=false;G.endP=0;
  P.stamina=1;P.exhausted=false;P.hitCD=0;P.shake=0;P.kick=0;
  Object.assign(C,{D:CFG.startGap,o:0,surf:0,surfTarget:0,emerged:false,diving:false,diveT:0,nextDive:rand(14,20),nextSurge:rand(10,15),surgeT:0,beatT:0});
  env.danger=0;L.ft=99;
  resetSnake();resetBanzeiro();resetTrees();resetWhirls();G.acai=0;G.finalScore=0;G.newBest=false;
  vignEl.style.opacity=0;
}
function onPhase(ph){
  showBanner('FASE '+(ph+1)+' — '+COURSE.names[ph],COURSE.subs[ph],COURSE.story[ph]);SFX.sting();
  if(ph===PH.ENCONTRO)WH.front=P.z-80;
  if(ph===PH.BANZEIRO){BZ.next=6;SN.next=rand(10,14);}
  if(ph===PH.MATA)FT.next=5;
}
function endIntroVisuals(){
  walkerG.visible=false;riderG.visible=true;ropeL.visible=false;stakeM.visible=false;
  fadeEl.style.transition='none';fadeEl.style.opacity=0;
}
function startGame(){
  resetRun();endIntroVisuals();
  G.state='playing';
  P.o=0;P.vo=0;P.s=13;camX=riverC(P.z);camY=3.1;
  setRunOrigin();
  L.next=3;
  resetObstacles(true);
  setUI();
  showBanner('FASE 1 — '+COURSE.names[0],COURSE.subs[0],COURSE.story[0]);
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
  showBanner('FASE 1 — '+COURSE.names[0],COURSE.subs[0],COURSE.story[0]);
}
function win(){
  G.endP=1;
  if(G.mission===1){                      // missão 1 cumprida: a criança recebe o remédio
    G.m1done=true;G.finalScore=calcScore(false);
    Store.submit({score:G.finalScore,time:Math.floor(G.t),progress:COURSE.L1/(COURSE.L1+COURSE.L2),won:false,acai:G.acai,phase:6,date:Date.now()},true);
    G.state='won';G.endDelay=3.5;setUI();
    toast('Medicamento entregue à comunidade!');SFX.arrive();
  }else{                                  // missão 2 cumprida: paciente no Polo Base
    G.finalScore=calcScore(true);
    G.newBest=Store.submit({score:G.finalScore,time:Math.floor(G.t),progress:1,won:true,acai:G.acai,phase:8,date:Date.now()});
    G.state='won';G.endDelay=3.5;setUI();
    toast('Paciente entregue ao Polo Base!');SFX.arrive();
  }
}
function intermission(){
  const e=$('end');e.className='overlay win';
  $('endTitle').textContent='VOCÊ ESCAPOU!';
  $('endSub').textContent='Missão 1 cumprida: o remédio chegou à Comunidade Boa Esperança e a febre da criança vai ceder. Pelo rádio, nova chamada: uma anciã espera na Aldeia Maripá, rio abaixo, e precisa ser levada ao Polo Base para avaliação médica. A equipe reparou um pouco a canoa.';
  $('endScore').textContent=G.finalScore+' pontos';
  show($('btnNext'));show(e);
}
function lose(){
  G.endP=overallP();G.finalScore=calcScore(false);
  G.newBest=Store.submit({score:G.finalScore,time:Math.floor(G.t),progress:G.endP,won:false,acai:G.acai,phase:G.phase,date:Date.now()});
  G.state='lost';G.endDelay=1.8;G.lostT=0;P.shake=1.4;
  if(G.cause==='wreck'){SFX.crash();emitSpray(P.x,0.3,P.z,40,6,8);}
  else{SFX.crunch();emitSpray(P.x,0.3,P.z+2,40,6,8);}
  vignEl.style.opacity=1;setUI();
}

/* ============================================================
   UPDATE
   ============================================================ */
/* Vida da canoa: toda batida (pedra, tronco, cobra, árvore, margem) causa dano */
function hurt(n){
  if(G.state!=='playing'||P.inv>0)return;
  if(G.patient)n*=1.3;                       // com paciente a bordo as batidas pesam mais
  P.hp=Math.max(0,P.hp-n);P.inv=0.5;P.hurtT=0.4;buzz(30);
  if(P.hp<=0){G.cause='wreck';lose();}
}
function updatePlayer(dt){
  const st=G.state;
  const moored=(st==='intro'&&G.ti<I.push);
  let steer=0,up=false,down=false;
  if(st==='playing'){steer=(inp.right?1:0)-(inp.left?1:0);if(Math.abs(inp.axis)>0.08)steer=inp.axis;up=inp.up;down=inp.down;}
  else if(st==='menu'){steer=clamp(-P.o*0.12-P.vo*0.25,-1,1);}
  else if(st==='won'){steer=clamp((riverW(P.z)/2-12-P.o)*0.12-P.vo*0.25,-1,1);}
  else if(st==='intro'&&!moored){steer=clamp((I.hw*0.6-P.o)*0.15-P.vo*0.12,-1,1);}
  if(G.board&&G.board.active){steer=clamp((riverW(P.z)/2-12-P.o)*0.12-P.vo*0.25,-1,1);up=false;down=false;}
  const cruise=st==='menu'?16:14+5*smooth(G.t/30);
  const cap=P.exhausted?CFG.vTired:CFG.vMax;
  let target=cruise;if(up)target=cap;else if(down)target=CFG.vMin;
  target=Math.min(target,cap*(1-0.2*env.bz));if(st==='lost'||st==='won'||(G.board&&G.board.active))target=0;
  const mz=meetW(P.z),kk=laneK(P.z,P.o);
  target*=1+mz*lerp(-0.12,0.18,(kk+1)/2);   // Negro mais lento, Solimões mais rápido
  const acc=target>P.s?20:(st==='lost'?14:26);
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
  const drift=-riverDDC(P.z)*P.s*P.s*0.8*(st==='lost'?0.3:1)+env.bz*15*Math.sin(T*1.7+BZ.ph)+mz*Math.max(0,kk)*7*Math.sin(T*2.1+P.z*0.07)*Math.sin(T*0.9+1);
  P.vo+=(steer*36+drift-P.vo*2.2)*dt;
  if(moored)P.vo=0;
  P.o+=P.vo*dt;
  const lim=riverW(P.z)/2-2.6;
  if(Math.abs(P.o)>lim){
    P.o=Math.sign(P.o)*lim;P.vo*=-0.35;
    if(st==='playing'&&P.hitCD<=0){P.s*=0.8;P.shake=Math.max(P.shake,0.6);P.hitCD=0.6;SFX.thud();emitSpray(P.x,0.2,P.z,14,3,4);hurt(5);}
  }
  P.hitCD-=dt;P.inv-=dt;P.hurtT-=dt;
  P.z-=P.s*dt;P.x=riverC(P.z)+P.o;
  P.yaw=damp(P.yaw,Math.atan2(riverDC(P.z)*P.s-P.vo,Math.max(P.s,5)),6,dt);
  // balanço nas ondas
  const amp=waveAmp();
  P.waveY=waveH(P.x,P.z,T,amp);
  const sp=(waveH(P.x,P.z-2.5,T,amp)-waveH(P.x,P.z+2.5,T,amp)+lvl(P.z-2.5)-lvl(P.z+2.5))/5;
  const sr=(waveH(P.x+0.7,P.z,T,amp)-waveH(P.x-0.7,P.z,T,amp))/1.4;
  P.roll=damp(P.roll,-P.vo*0.02+Math.atan(sr)*1.5+(st==='lost'?Math.sin(T*9)*0.25:0)+Math.sin(T*8)*0.1*P.kick+env.bz*0.2*Math.sin(T*2.4),6,dt);
  P.kick*=Math.exp(-2.2*dt);
  P.pitch=damp(P.pitch,Math.atan(sp)*1.5+(P.s/CFG.vMax)*0.05,6,dt);
  canoeG.position.set(P.x,P.waveY*0.9+0.08-0.12*P.kick+lvl(P.z)+whirlDip(P.x,P.z)-(st==='lost'&&G.cause==='wreck'?Math.min(1.8,G.lostT*0.9):0),P.z);
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
    if(t>=CFG.appearT&&!C.emerged&&(G.mission===1||G.patient)){C.emerged=true;emergeFx(true);}
    if(C.emerged){
      if(!C.diving){C.nextDive-=dt;if(C.nextDive<=0){C.diving=true;C.diveT=2.2;}}
      else{C.diveT-=dt;if(C.diveT<=0){C.diving=false;C.nextDive=rand(12,20);C.surgeT=rand(1.6,2.4);emergeFx(false);}}
      const pp=G.mission===2?0.65+0.35*env.p:env.p;let vC=14+8*smooth(pp)+(G.phase>=PH.IGAPO?1:0);
      if(C.surgeT>0){vC+=6;C.surgeT-=dt;}
      else{C.nextSurge-=dt;if(C.nextSurge<=0){C.surgeT=rand(1.8,3);C.nextSurge=rand(11,18);SFX.growl();}}
      if(C.diving)vC*=0.7;
      if(C.D>70)vC+=(C.D-70)*0.07;
      C.D=clamp(C.D+(P.s-vC)*dt,0,CFG.maxGap);C.vC=vC;
      C.surfTarget=C.diving?0:1;
      danger=clamp((CFG.dangerDist-C.D)/(CFG.dangerDist-CFG.catchDist),0,1);
      if(C.D<=CFG.catchDist){G.cause='croc';lose();danger=1;}
    }else{C.surfTarget=0;C.vC=P.s;}
  }else if(st==='lost'){if(G.cause==='croc'){C.D=damp(C.D,2.6,5,dt);C.surfTarget=1;danger=1;}else C.surfTarget=0;}
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
  crocG.position.set(C.x,lerp(-1.9,-0.38,C.surf)+waveH(C.x,C.z,T,amp)*0.7+lvl(C.z),C.z);
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
  camX=damp(camX,P.x+sy*back,7,dt);camY=damp(camY,3.1+P.waveY*0.6+lvl(P.z),4,dt);
  P.shake=Math.max(P.shake*Math.exp(-4*dt),env.danger*0.45,env.bz*0.35);
  const sh=P.shake*0.28;
  camNP.set(camX+Math.sin(T*53)*sh*0.7,camY+Math.sin(T*61+1)*sh*0.5,P.z+cy*back);
  camNL.set(P.x-sy*10,0.9+lvl(P.z-10),P.z-cy*10);
  if(G.state==='intro')introCamera(camNP,camNL);
  camera.position.copy(camNP);camera.lookAt(camNL);
  camera.rotateZ(P.roll*0.5+Math.sin(T*47+2)*P.shake*0.02);
  const fovT=G.state==='intro'?lerp(40,60,smooth((G.ti-3.0)/4.5)):60+13*Math.pow(P.s/CFG.vMax,1.5);camera.fov=damp(camera.fov,fovT,G.state==='intro'?8:3,dt);camera.updateProjectionMatrix();
  // câmera traseira (quadro ATRÁS)
  const bs=Math.sin(P.yaw),bc=Math.cos(P.yaw);
  rearCam.position.set(P.x+bs*3.3,1.7+P.waveY+lvl(P.z),P.z+bc*3.3);
  rearCam.lookAt(P.x+bs*30,0.9+lvl(P.z+20),P.z+bc*30);
}
function updateWorldFx(dt){
  const rain=env.rain,f=env.flash,w=env.warm,dl=env.dl;
  scene.fog.density=lerp(0.0095,0.0135,rain)+0.0015*w+0.002*(1-dl)+0.004*env.ig;
  fogBase.copy(fogNight).lerp(fogCool,dl).lerp(fogWarm,w);
  fogTmp.copy(fogBase).lerp(fogFlash,f*0.7);scene.fog.color.copy(fogTmp);renderer.setClearColor(fogTmp);
  const su=skyMat.uniforms;
  su.uHorizon.value.copy(fogTmp);su.uTime.value=T;su.uFlash.value=f;su.uNight.value=1-dl;su.uWarm.value=w;su.uCloud.value=env.cloud;
  su.uZenith.value.copy(zenNight).lerp(zenCool,dl).lerp(zenWarm,w);
  hemi.color.copy(hemiNight).lerp(hemiCool,dl).lerp(hemiWarm,w);
  sun.color.copy(sunNight).lerp(sunCool,dl).lerp(sunWarm,w);
  hemi.intensity=lerp(0.42,0.62,dl)+0.2*w+2.2*f;sun.intensity=lerp(0.3,0.55,dl)+0.4*w+1.6*f;
  lamp.intensity=(1-dl)*1.8;
  $('flashFx').style.opacity=Math.min(0.5,f*0.45);
  const u=waterMat.uniforms;
  u.uTime.value=T;u.uAmp.value=waveAmp();u.uRain.value=rain;u.uFlash.value=f;u.uSky.value.copy(fogTmp);u.uSpeed.value=P.s;
  u.uCanoe.value.set(P.x,P.z);u.uCroc.value.set(C.x,C.z-CROC_TIP);u.uCrocVis.value=C.surf;
  const la=u.uLed.value;for(let i=0;i<3;i++)la[i]=LEDGES[i]!==undefined?LEDGES[i]:0;u.uLedN.value=LEDGES.length;
  for(let i=0;i<3;i++){const w=WH.slots[i];u.uWx.value[i]=w.x;u.uWz.value[i]=w.z;u.uWr.value[i]=w.r;}
  const mzz=meetZ();u.uMeetA.value=mzz[0];u.uMeetB.value=mzz[1];u.uMeetOn.value=env.run?1:0;
  u.uMoon.value=(1-dl)*(1-0.7*Math.min(1,rain));
  u.uLamp.value.set(P.x-Math.sin(P.yaw)*2.2,0,P.z-Math.cos(P.yaw)*2.2);u.uLampI.value=(1-dl)*1.0;
  water.position.set(P.x,0,P.z);
  const r=rainMat.uniforms;r.uTime.value=T;r.uInt.value=(0.18+0.82*rain)*QF[quality].rain;r.uWind.value=4+5*rain;r.uBaseY.value=lvl(P.z)-1;
  sky.position.copy(camera.position);
  updateSpray(dt);
}
function update(dt){
  T+=dt;
  const st=G.state;
  if(st==='playing')G.t+=dt;
  if(st==='intro')G.ti+=dt;
  if(st==='lost')G.lostT+=dt;
  const t=G.t;
  const run=st==='playing'||st==='won'||st==='lost'||st==='paused';
  env.run=run;
  if(st==='menu')RUN_Z0=P.z;
  env.p=run?progressAt(P.z):0;
  if(run&&env.p>0.25)worldDirty=true;
  const p=env.p;
  let rainT;
  if(st==='menu')rainT=0.45;else if(st==='intro')rainT=0.3;else if(st==='won')rainT=0.05;
  else rainT=pw(p,G.mission===2?RAIN2:RAINK);
  env.rain=damp(env.rain,rainT,1.5,dt);
  env.dl=damp(env.dl,run?pw(p,G.mission===2?DL2:DL):0.85,1.0,dt);
  env.warm=damp(env.warm,run?pw(p,G.mission===2?WARM2:WARMK):0,1.0,dt);
  env.cloud=damp(env.cloud,run?(G.mission===2?lerp(0.35,0.15,p):lerp(1,0.35,smooth((p-0.85)/0.15))):1,1.0,dt);
  env.ig=run?igapoAt(p):0;
  for(const k in inp)inp[k]=kb[k]||tc[k];
  inp.axis=clamp((tc.axis||0)+(tilt.on?tilt.axis:0),-1,1);
  if(autoPaddle){if(P.stamina<0.08)autoHold=false;else if(P.stamina>0.35)autoHold=true;inp.up=inp.up||(autoHold&&!inp.down);}
  updateBanzeiro(dt);
  updatePlayer(dt);
  updateIntro(dt);
  updateCroc(dt);
  updateObstacles(dt);
  updateSnake(dt);
  updateWhirls(dt);
  updateTrees(dt);
  updatePickups(dt);
  updateLedges(dt);
  updateKits(dt);
  updateMission2(dt);
  updateDock(dt);
  updateBoarding(dt);
  updateVillage();
  updateFireflies();
  updateMist();
  updateForest();
  updateBanks();
  updateLightning(dt);
  updateCamera(dt);
  updateWorldFx(dt);
  SFX.update(env.rain,P.s/CFG.vMax,env.danger,dt,env.bz,env.fall);
  updateDrops(dt);
  if(st==='playing'){
    const ph=G.mission===2?(G.patient?PH.POLO:PH.BUSCA):phaseOf(p);
    if(ph!==G.phase){G.phase=ph;onPhase(ph);}
    while(G.evt<EVENTS.length&&t>=EVENTS[G.evt][0]){toast(EVENTS[G.evt][1]);G.evt++;}
    if(p>0.93&&!G.near&&(G.mission===1||G.patient)){G.near=true;toast(G.mission===1?'As luzes da comunidade! Falta pouco!':'O Polo Base à vista!');}
    if(P.z<=zEnd()&&(G.mission===1||G.patient))win();
    vignEl.style.opacity=Math.max(env.danger*0.9,Math.max(0,P.hurtT)/0.4*0.85,P.hp<30?0.25+0.15*Math.sin(T*6):0);
  }
  if(G.endDelay>0){G.endDelay-=dt;if(G.endDelay<=0){if(G.state==='won'&&G.mission===1)intermission();else endScreen(G.state==='won');}}
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
const PERF={acc:0,n:0,pr:Math.min(window.devicePixelRatio||1,QF[quality].pr)};
function adaptQuality(dt){ // se o aparelho estiver lento, reduz a resolução aos poucos
  if(T<6||G.state==='menu')return;
  PERF.acc+=dt;PERF.n++;
  if(PERF.acc>=3){
    const fps=PERF.n/PERF.acc;PERF.acc=0;PERF.n=0;
    if(fps<38&&PERF.pr>0.7){PERF.pr=Math.max(0.7,PERF.pr*0.82);renderer.setPixelRatio(PERF.pr);renderer.setSize(innerWidth,innerHeight);}
  }
}
let last=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  if(G.state!=='paused'){update(dt);adaptQuality(dt);}
  render();
}
/* arranque: o menu mostra o rio ao fundo enquanto a canoa desliza */
document.addEventListener('visibilitychange',()=>{if(document.hidden&&G.state==='playing')togglePause();});
onResize();renderPlayer();renderScore();syncOpts();document.body.classList.toggle('touch',IS_TOUCH);setUI();resetObstacles(false);
requestAnimationFrame(frame);
})();
