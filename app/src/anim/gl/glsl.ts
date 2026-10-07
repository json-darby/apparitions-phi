// Shader sources. Plain GLSL ES 1.00 (runs on WebGL 1 and 2). The "source"
// shaders (face, figure, object, scene) draw into a small offscreen texture:
//   R = brightness, G = depth (1 near .. 0 far), B = special (hand), A = mask.
// The dot shaders (cloud, particles) turn that into glowing dots with depth,
// row tears, gather, dispersal and touch scatter, as in animation-demos 1 to 4.

export const FS_HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

export const FULL_VS = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.,1.); }`;

export const COMMON = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(hash(vec2(i,7.)),hash(vec2(i+1.,7.)),f);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float smax(float a,float b,float k){return -smin(-a,-b,k);}
float ell(vec3 p,vec3 r){float k0=length(p/r),k1=length(p/(r*r));return k0*(k0-1.)/k1;}
float sph(vec3 p,float r){return length(p)-r;}
float cap(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h)-r;}
float rbox(vec3 p,vec3 b,float r){vec3 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.)-r;}
float tor(vec3 p,float R,float r){return length(vec2(length(p.xy)-R,p.z))-r;}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
`;

// ---------------------------------------------------------------- head
export const HEAD = `
uniform vec4 uShape; // head width, jaw width, face length, cheeks
uniform vec4 uAge;   // age, masculine, neck, nose
uniform vec4 uHair;  // style, volume, brightness, fringe
uniform vec4 uAcc;   // collar, headwear, cloth brightness, skin brightness
uniform vec4 uEx;    // smile, lid, jaw open, brow up
uniform vec4 uEx2;   // brow asym, brow sad, mouth shift, squint
uniform vec4 uPose;  // head yaw, head pitch, head roll, torso yaw
uniform vec2 uGaze;

const vec3 PIV=vec3(0.,-.75,-.1);
vec3 toHead(vec3 p){
  vec3 h=p-PIV;
  h.xy*=rot(uPose.z);
  h.yz*=rot(uPose.y);
  h.xz*=rot(uPose.x);
  return h+PIV;
}
vec3 toTorso(vec3 p){ vec3 t=p; t.xz*=rot(uPose.w); return t; }

float hairSDF(vec3 p,vec3 q){
  float st=uHair.x, vol=uHair.y;
  float shell=ell(p-vec3(0.,.3,-.14),vec3(.87*uShape.x,.97,.99)*vol);
  float face=ell(p-vec3(0.,-.25,.8),vec3(.66*uShape.x,1.05,.78));
  float h=max(shell,-face);
  float back=smoothstep(.1,-.55,p.z);
  if(st<.5){ // crop
    h=max(h,mix(.14,-.42,back)-p.y);
  } else if(st<1.5){ // short, practical, full
    h=max(h,mix(-.1,-.5,back)-p.y);
    h=smin(h,max(ell(q-vec3(.62*uShape.x,.12,-.12),vec3(.26,.3,.42)),-face),.12);
  } else if(st<2.5){ // tied back with a bun
    h=max(h,mix(.16,-.48,back)-p.y);
    h=smin(h,sph(p-vec3(0.,.4,-.95),.26),.1);
  } else if(st<3.5){ // long, falling behind the shoulders
    h=max(h,mix(.06,-.3,back)-p.y);
    h=smin(h,ell(p-vec3(0.,-.78,-.52),vec3(.8*uShape.x,1.28,.36)),.2);
    h=smin(h,max(cap(q,vec3(.7*uShape.x,.22,.0),vec3(.8,-1.5,-.05),.15),-ell(p-vec3(0.,-.25,.85),vec3(.6*uShape.x,1.05,.78))),.14);
  } else if(st<4.5){ // bob with a fringe
    h=max(h,-.6-p.y);
    h=smin(h,max(cap(q,vec3(.68*uShape.x,.32,.02),vec3(.64*uShape.x,-.5,.14),.17),-ell(p-vec3(0.,-.25,.85),vec3(.6*uShape.x,1.05,.78))),.12);
    h=max(h,-.6+.04*sin(p.x*20.)-p.y);
    float fr=max(ell(p-vec3(.06,.55,.42),vec3(.7*uShape.x,.26,.44)),.38+.04*sin(p.x*23.)+.08*p.x-p.y);
    h=smin(h,fr,.16);
  } else { // quiff
    h=max(h,mix(.14,-.42,back)-p.y);
    h=smin(h,ell(p-vec3(0.,.84,.3),vec3(.52,.25,.44)),.13);
  }
  return h;
}

vec2 headMap(vec3 p){
  float hw=uShape.x, jw=uShape.y, fl=uShape.z, ck=uShape.w;
  float age=uAge.x, masc=uAge.y;
  vec3 q=p; q.x=abs(q.x);
  float d=ell(p-vec3(0.,.14,0.),vec3(.74*hw,.86*fl,.86));
  float jy=-.42-.03*age-uEx.z*.5;
  d=smin(d,ell(p-vec3(0.,jy,.1),vec3(.52*jw,.56*fl,.62)),.25);
  d=smin(d,sph(p-vec3(0.,-.86*fl-uEx.z,.42),.19+.03*masc),.2);
  d=smin(d,sph(q-vec3(.39*hw,-.16-.05*age+.05*max(uEx.x,0.),.5),.25*(.82+.2*ck)),.2);
  d=smin(d,ell(q-vec3(.24,.3,.74),vec3(.28,.08+.02*masc,.13)),.12);
  d=smax(d,-sph(q-vec3(.29,.13,.9),.125),.09);
  // eyelids
  float lidY=mix(.19,.04,clamp(uEx.y,0.,1.));
  float lidU=max(ell(q-vec3(.29,.125,.745),vec3(.136,.09,.113)),lidY-q.y);
  float lowY=.055+.035*uEx2.w;
  float lidL=max(ell(q-vec3(.29,.12,.742),vec3(.133,.086,.11)),q.y-lowY);
  d=smin(d,min(lidU,lidL),.012);
  // nose
  d=smin(d,ell(p-vec3(0.,.02,.82),vec3(.085*uAge.w,.3,.16)),.08);
  d=smin(d,sph(p-vec3(0.,-.24,.97),.11*mix(1.,uAge.w,.6)),.08);
  d=smin(d,sph(q-vec3(.1*uAge.w,-.28,.86),.07),.05);
  // mouth, bent by the smile
  vec3 m=p; m.x-=uEx2.z*.05; float sm=uEx.x;
  m.x/=1.+.12*max(sm,0.);
  m.y-=sm*1.5*m.x*m.x-.012*sm;
  d=smin(d,ell(m-vec3(0.,-.52,.8),vec3(.2,.055,.12)),.04);
  d=smin(d,ell(m-vec3(0.,-.63-uEx.z,.78),vec3(.17,.065,.12)),.04);
  d=smax(d,-ell(m-vec3(0.,-.575-uEx.z*.5,.9),vec3(.19,.016+uEx.z*.6,.1)),.02);
  // ears
  d=smin(d,ell(q-vec3(.76*hw,.05,-.05),vec3(.07,.2,.13)),.05);
  vec2 r=vec2(d,0.);
  float eye=ell(q-vec3(.29,.12,.74),vec3(.12,.075,.1));
  if(eye<r.x) r=vec2(eye,3.);
  float h=hairSDF(p,q);
  if(h<r.x) r=vec2(h,1.);
  if(uAcc.y>.5&&uAcc.y<1.5){
    float dome=max(ell(p-vec3(0.,.36,-.06),vec3(.86*hw,.74,.95)),.28-p.y);
    vec3 b=p-vec3(0.,.36,.8); b.y+=.14*b.z;
    float brim=max(ell(b,vec3(.6,.035,.46)),.52-p.z);
    float c=min(dome,brim);
    if(c<r.x) r=vec2(c,2.);
  } else if(uAcc.y>1.5){
    vec3 l=q-vec3(.25,.76,.46); l.yz*=rot(1.0);
    float g=ell(l,vec3(.16,.11,.03));
    g=min(g,cap(q,vec3(0.,.8,.56),vec3(.12,.79,.54),.022));
    g=min(g,cap(q,vec3(.4,.72,.38),vec3(.8,.42,-.12),.02));
    if(g<r.x) r=vec2(g,4.);
  }
  return r;
}

float necklineY(float x){
  float c=uAcc.x, ax=abs(x);
  if(c<.5) return -1.6+.5*x*x;
  if(c<1.5) return -1.47+.2*x*x;
  if(c<2.5) return -1.42;
  if(c<3.5) return -1.6-1.1*max(0.,.33-ax);
  if(c<4.5) return -1.48-1.6*max(0.,.3-ax);
  if(c<5.5) return -1.6+.5*x*x;
  return -1.5-.9*max(0.,.28-ax);
}

vec2 torsoMap(vec3 p){
  vec3 q=p; q.x=abs(q.x);
  float masc=uAge.y;
  float nk=cap(p,vec3(0.,-.7,-.15),vec3(0.,-1.9,-.28),.29+.07*masc*uAge.z+.02*uAge.z);
  float sh=ell(p-vec3(0.,-2.3,-.25),vec3(1.42+.2*masc,.52,.62));
  float d=smin(nk,sh,.3);
  float col=uAcc.x, c=1e5;
  if(col>.5&&col<1.5) c=cap(q,vec3(.16,-1.42,.2),vec3(.46,-1.62,.05),.06);
  else if(col>1.5&&col<2.5){ vec3 r=p-vec3(0.,-1.42,-.2); c=length(vec2(length(r.xz*vec2(1.,1.15))-.36,r.y))-.07; }
  else if(col>2.5&&col<3.5){ c=min(cap(q,vec3(.12,-1.58,.43),vec3(.52,-2.4,.42),.07),cap(q,vec3(.3,-1.48,.16),vec3(.12,-1.58,.43),.06)); }
  else if(col>3.5&&col<4.5) c=cap(q,vec3(.2,-1.45,.25),vec3(.62,-1.72,.12),.06);
  else if(col>4.5&&col<5.5) c=cap(q,vec3(.33,-1.64,.26),vec3(.3,-2.6,.5),.05);
  else if(col>5.5) c=cap(q,vec3(.14,-1.42,.22),vec3(.42,-1.72,.14),.055);
  vec2 r=vec2(d,6.);
  if(c<r.x) r=vec2(c,2.);
  return r;
}

vec2 bustMap(vec3 p){
  vec2 r=torsoMap(toTorso(p));
  vec2 h=headMap(toHead(p));
  if(h.x<r.x) r=h;
  return r;
}

// brightness for a hit on the bust; mat as from the map
float bustLum(vec3 p,vec3 n,vec3 rd,float mat,float ao){
  vec3 l=normalize(vec3(.4,.36,.85));
  float dif=max(dot(n,l),0.);
  float fill=max(dot(n,normalize(vec3(-.7,0.,.6))),0.)*.3;
  float rim=pow(1.-max(dot(n,-rd),0.),3.)*.32*step(0.,n.x+.3);
  float lum=(pow(dif,1.3)*.92+fill*.8)*(.45+.55*ao)+rim;
  vec3 hp=toHead(p);
  float x=abs(hp.x), side=sign(hp.x);
  if(mat<.5){
    lum=pow(lum,1.1)*uAcc.w;
    // brows
    float by=.29+.04*uEx.w+.045*uEx2.x*side+uEx2.y*.13*(.36-x)-1.1*(x-.27)*(x-.27);
    float brow=exp(-pow((hp.y-by)/.028,2.))*smoothstep(.08,.13,x)*smoothstep(.48,.4,x)*step(.5,hp.z);
    lum*=1.-.6*brow;
    // lines that come with age and with smiling
    vec2 a=vec2(.1,-.25), b=vec2(.27,-.6); vec2 pa=vec2(x,hp.y)-a, ba=b-a;
    float hh=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); float dl=length(pa-ba*hh);
    lum*=1.-(uAge.x*.35+.25*max(uEx.x,0.))*exp(-pow(dl/.022,2.))*step(.55,hp.z);
    float bag=exp(-pow((length(vec2(x-.29,(hp.y-.1)*1.5))-.13)/.016,2.))*step(hp.y,.07)*step(.6,hp.z);
    lum*=1.-uAge.x*.3*bag;
    lum*=1.-max(uAge.x-.5,0.)*.4*smoothstep(.42,.5,hp.y)*smoothstep(.72,.62,hp.y)*(.5+.5*sin(hp.y*95.))*step(.55,hp.z);
  } else if(mat<1.5){
    float st=.5+.5*sin(hp.x*60.+hp.z*40.+sin(hp.y*3.)*4.);
    lum=lum*(.25+.55*st)*uHair.z*1.4;
  } else if(mat<2.5){
    lum*=uAcc.z*(.88+.12*sin(p.y*14.+p.x*3.));
  } else if(mat<3.5){
    vec3 e=vec3(x,hp.y,hp.z)-vec3(.29,.12,.74);
    vec2 c=vec2(.07*uGaze.x*side,.045*uGaze.y);
    float dd=length(e.xy-c);
    float v=mix(.66,.2,smoothstep(.054,.046,dd));
    v=mix(v,.04,smoothstep(.026,.02,dd));
    v=max(v,smoothstep(.016,.006,length(e.xy-c-vec2(.018*side,.024))));
    lum=v*(.55+.45*dif)*uAcc.w;
  } else if(mat<4.5){
    lum=lum*.22+pow(max(dot(reflect(rd,n),l),0.),24.)*.9;
  } else if(mat>5.5){
    float skin=step(necklineY(p.x),p.y);
    lum*=mix(uAcc.z*(.88+.12*sin(p.y*14.+p.x*3.)),uAcc.w*.8,skin);
  }
  return smoothstep(.03,1.02,lum);
}
`;

// ---------------------------------------------------------------- bust raymarch main (faces)
export const FACE_FS = `${FS_HEAD}
uniform vec2 uRes;
uniform vec4 uCam; // zoom, centre y, depth far, depth range
uniform vec2 uFade;
${COMMON}
${HEAD}
vec2 map(vec3 p){ return bustMap(p); }
vec3 nor(vec3 p){vec2 e=vec2(.004,-.004);return normalize(e.xyy*map(p+e.xyy).x+e.yyx*map(p+e.yyx).x+e.yxy*map(p+e.yxy).x+e.xxx*map(p+e.xxx).x);}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  vec3 ro=vec3(0.,uCam.y,3.6), rd=normalize(vec3(uv*uCam.x,-1.75));
  // bounding sphere around head and shoulders
  vec3 oc=ro-vec3(0.,-.9,-.1); float b=dot(oc,rd), c=dot(oc,oc)-2.75*2.75, h=b*b-c;
  if(h<0.){gl_FragColor=vec4(0.);return;}
  float t=max(0.,-b-sqrt(h)), tmax=-b+sqrt(h);
  vec2 m=vec2(0.); bool hit=false;
  for(int i=0;i<72;i++){ m=map(ro+rd*t); if(m.x<.002){hit=true;break;} t+=m.x*.9; if(t>tmax)break; }
  if(!hit){gl_FragColor=vec4(0.);return;}
  vec3 p=ro+rd*t, n=nor(p);
  float ao=clamp(map(p+n*.12).x/.12,0.,1.);
  float lum=bustLum(p,n,rd,m.y,ao);
  lum*=smoothstep(uFade.x,uFade.y,p.y);
  gl_FragColor=vec4(clamp(lum,0.,1.),clamp((uCam.z-t)/uCam.w,0.,1.),0.,1.);
}`;

// ---------------------------------------------------------------- figure (sequences)
export const FIGURE_FS = `${FS_HEAD}
uniform vec2 uRes;
uniform vec4 uCam;
uniform vec2 uFade;
uniform float uScene;  // 1 palm, 2 wai, 3 handover, 4 glance, 5 walk
uniform vec4 uHand0;   // x, y, z, visible
uniform vec4 uHand1;   // pitch, yaw, scale, flatten
uniform float uArm;
uniform float uLean;
uniform vec4 uWalk;    // z, stride phase, body yaw, visible
${COMMON}
${HEAD}
float fingers(vec3 p){
  float d=rbox(p-vec3(0.,-.04,0.),vec3(.25,.27,.06),.07);
  d=smin(d,cap(p,vec3(.19,.2,0.),vec3(.25,.57,0.),.052),.05);
  d=smin(d,cap(p,vec3(.065,.22,0.),vec3(.08,.66,0.),.056),.05);
  d=smin(d,cap(p,vec3(-.065,.22,0.),vec3(-.08,.62,0.),.054),.05);
  d=smin(d,cap(p,vec3(-.19,.19,0.),vec3(-.25,.5,0.),.048),.05);
  d=smin(d,cap(p,vec3(.24,-.12,.03),vec3(.47,.1,.07),.062),.07);
  return d;
}
float handSDF(vec3 p,float fl){ p.z/=max(.35,1.-.6*fl); return fingers(p)*max(.35,1.-.6*fl); }
float handB(vec3 p,vec3 c,vec3 Y,vec3 Z,vec3 X,float s,float fl){ vec3 h=p-c; vec3 l=vec3(dot(h,X),dot(h,Y),dot(h,Z)); return handSDF(l/s,fl)*s; }
float limb(vec3 p,vec3 sh,vec3 el,vec3 wr){ return smin(cap(p,sh,el,.19),cap(p,el,wr,.15),.1); }

vec2 walkMap(vec3 p){
  p.z-=uWalk.x;
  p.xz*=rot(uWalk.z);
  float moving=step(.001,-uWalk.x);
  float sw=sin(uWalk.y)*.5*moving;
  p.y-=abs(cos(uWalk.y))*.035*moving;
  vec3 q=p; q.x=abs(q.x);
  vec3 hp=p-vec3(0.,1.55,0.);
  float head=ell(hp,vec3(.19,.24,.21));
  float hair=max(ell(hp-vec3(0.,.04,-.03),vec3(.21,.25,.23)),-ell(hp-vec3(0.,-.12,.14),vec3(.16,.24,.14)));
  if(uHair.x>2.5&&uHair.x<3.5) hair=smin(hair,ell(hp-vec3(0.,-.25,-.12),vec3(.2,.32,.1)),.06);
  if(uHair.x>3.5&&uHair.x<4.5) hair=max(hair,-.13-hp.y);
  float body=cap(p,vec3(0.,1.36,0.),vec3(0.,1.2,0.),.07);
  body=smin(body,rbox(p-vec3(0.,.86,0.),vec3(.27,.34,.13),.12),.06);
  body=smin(body,rbox(p-vec3(0.,.38,0.),vec3(.24,.14,.13),.1),.06);
  float legs=1e5;
  for(int i=0;i<2;i++){
    float s=i==0?1.:-1.;
    float a=s*sw;
    vec3 hip=vec3(.12*s,.3,0.);
    vec3 knee=hip+vec3(0.,-.47*cos(a),.47*sin(a));
    float bend=max(0.,-a)*.9;
    vec3 ank=knee+vec3(0.,-.47*cos(a-bend),.47*sin(a-bend));
    legs=min(legs,smin(cap(p,hip,knee,.1),cap(p,knee,ank,.08),.05));
    vec3 shd=vec3(.34*s,1.13,0.);
    vec3 elb=shd+vec3(.03*s,-.32*cos(a),-.32*sin(a));
    vec3 hnd=elb+vec3(0.,-.3*cos(a*1.2),-.3*sin(a*1.2)+.04);
    legs=min(legs,smin(cap(p,shd,elb,.07),cap(p,elb,hnd,.06),.04));
  }
  vec2 r=vec2(head,0.);
  if(hair<r.x) r=vec2(hair,1.);
  float cl=min(body,legs);
  if(cl<r.x) r=vec2(cl,2.);
  return r;
}

vec2 map(vec3 p){
  if(uScene>4.5) return walkMap(p);
  vec3 lp=p-vec3(0.,-3.2,-.2); lp.yz*=rot(-uLean); lp+=vec3(0.,-3.2,-.2);
  vec2 r=bustMap(lp);
  if(uScene<1.5){
    if(uHand0.w>.5){
      vec3 h=p-uHand0.xyz; h.yz*=rot(uHand1.x); h.xz*=rot(uHand1.y);
      float s=uHand1.z;
      float d=handSDF(h/s,uHand1.w)*s;
      vec3 wr=uHand0.xyz+vec3(0.,-.36*s,-.04);
      d=smin(d,limb(p,vec3(-1.,-2.15,-.25),uHand0.xyz+vec3(-.25,-1.35,-.75),wr),.08);
      if(d<r.x) r=vec2(d,5.);
    }
  } else if(uScene<2.5){
    vec3 q=lp; q.x=abs(q.x);
    float k=uArm;
    vec3 c=mix(vec3(.95,-3.5,.2),vec3(.085,-1.68,.92),k);
    vec3 Y=normalize(mix(vec3(0.,-1.,0.),vec3(0.,1.,.12),k));
    vec3 Z=normalize(mix(vec3(0.,0.,1.),vec3(-1.,0.,0.),k));
    vec3 X=normalize(mix(vec3(1.,0.,0.),vec3(0.,0.,-1.),k));
    float d=handB(q,c,Y,Z,X,1.08,0.);
    vec3 wr=c-Y*.36;
    vec3 el=mix(vec3(1.1,-3.6,-.1),vec3(.68,-2.55,.45),k);
    d=smin(d,limb(q,vec3(1.,-2.15,-.25),el,wr),.08);
    if(d<r.x) r=vec2(d,0.);
  } else if(uScene<3.5){
    if(uHand0.w>.5){
      vec3 b=p-uHand0.xyz;
      float bag=rbox(b,vec3(.42,.5,.2),.08);
      vec3 tb=b-vec3(0.,.5,0.);
      bag=min(bag,max(tor(tb,.24,.035),-tb.y));
      float fist=ell(b-vec3(0.,.78,0.),vec3(.17,.15,.16));
      float arm=limb(p,vec3(.98,-2.15,-.25),mix(vec3(1.05,-2.9,.2),uHand0.xyz+vec3(.45,-.55,-.7),uArm),uHand0.xyz+vec3(0.,.8,0.));
      if(bag<r.x) r=vec2(bag,2.);
      float sk=smin(fist,arm,.08);
      if(sk<r.x) r=vec2(sk,0.);
    }
  } else {
    float seat=rbox(p-vec3(0.,-2.55,.9),vec3(1.25,.75,.18),.16);
    seat=min(seat,rbox(p-vec3(0.,-1.5,.95),vec3(.46,.3,.14),.13));
    vec3 pq=p; pq.x=abs(pq.x);
    seat=min(seat,cap(pq,vec3(.22,-1.8,.95),vec3(.22,-2.,.95),.03));
    if(seat<r.x) r=vec2(seat,7.);
    vec3 lq=p-vec3(0.,.45,-4.5); lq.x=mod(lq.x+.9,1.8)-.9;
    float lights=sph(lq,.09);
    if(lights<r.x) r=vec2(lights,8.);
  }
  return r;
}
vec3 nor(vec3 p){vec2 e=vec2(.004,-.004);return normalize(e.xyy*map(p+e.xyy).x+e.yyx*map(p+e.yyx).x+e.yxy*map(p+e.yxy).x+e.xxx*map(p+e.xxx).x);}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  vec3 ro=vec3(0.,uCam.y,3.6), rd=normalize(vec3(uv*uCam.x,-1.75));
  float t=.5; vec2 m=vec2(0.); bool hit=false;
  for(int i=0;i<90;i++){ m=map(ro+rd*t); if(m.x<.002*t){hit=true;break;} t+=m.x*.8; if(t>16.)break; }
  if(!hit){gl_FragColor=vec4(0.);return;}
  vec3 p=ro+rd*t, n=nor(p);
  float ao=clamp(map(p+n*.12).x/.12,0.,1.);
  float lum, special=0.;
  if(m.y>7.5){ lum=.9; }
  else if(m.y>6.5){ vec3 l=normalize(vec3(.3,.3,.9)); lum=(.15+.35*max(dot(n,l),0.))*(.5+.5*ao); }
  else if(m.y>4.5&&m.y<5.5){
    vec3 l=normalize(vec3(.3,.3,.9));
    lum=(pow(max(dot(n,l),0.),1.2)*.85+.15)*(.55+.45*ao)*uAcc.w;
    lum+=uHand1.w*.35;
    special=1.;
  } else lum=bustLum(p,n,rd,m.y,ao);
  if(uScene<4.5) lum*=smoothstep(uFade.x,uFade.y,p.y);
  gl_FragColor=vec4(clamp(lum,0.,1.),clamp((uCam.z-t)/uCam.w,0.,1.),special,1.);
}`;

// ---------------------------------------------------------------- objects
export const OBJECT_FS = `${FS_HEAD}
uniform vec2 uRes;
uniform float uObj;  // 0 dish, 1 tuk-tuk, 2 temple roof, 3 banknote, 4 bottle, 5 glass of ice, 6 market stall, 7 thing
uniform float uYaw;
uniform float uTilt;
${COMMON}
float digit1(vec2 p){ return step(abs(p.x),.025)*step(abs(p.y),.11); }
float digit0(vec2 p){ float r=length(p*vec2(1.5,1.)); return smoothstep(.02,.0,abs(r-.09)-.012); }
vec2 objMap(vec3 p){
  p.xz*=rot(uYaw);
  vec3 q=p; q.z=abs(q.z);
  if(uObj<.5){
    float plate=rbox(p-vec3(0.,-.2,0.),vec3(1.05,.035,1.05),.03);
    plate=max(length(p.xz)-1.08,plate);
    float rim=length(vec2(length(p.xz)-.98,p.y+.15))-.05;
    plate=smin(plate,rim,.06);
    float rice=ell(p-vec3(-.08,.0,-.05),vec3(.66,.34,.6))-.02*sin(p.x*41.)*sin(p.z*37.)*sin(p.y*43.);
    vec3 c1=p-vec3(.68,-.12,.42); c1.xy*=rot(.35); float cu=max(length(c1.xz)-.17,abs(c1.y)-.025);
    vec3 c2=p-vec3(.78,-.12,.04); c2.xy*=rot(.5); cu=min(cu,max(length(c2.xz)-.16,abs(c2.y)-.025));
    float lime=max(ell(p-vec3(.45,-.08,-.62),vec3(.22,.12,.13)),-(p.y+.08));
    vec2 r=vec2(plate,2.);
    if(rice<r.x) r=vec2(rice,0.);
    if(cu<r.x) r=vec2(cu,1.);
    if(lime<r.x) r=vec2(lime,1.);
    return r;
  }
  if(uObj<1.5){
    vec3 b=p-vec3(-.05,.0,0.);
    float body=rbox(b,vec3(.95,.3,.55),.14);
    body=smin(body,rbox(p-vec3(.98,.02,0.),vec3(.22,.34,.2),.1),.15);
    float roof=rbox(p-vec3(-.05,.98,0.),vec3(1.1,.045,.62),.04);
    roof=smin(roof,rbox(p-vec3(1.0,.9,0.),vec3(.18,.04,.5),.03),.08);
    float pil=min(cap(q,vec3(.82,.3,.5),vec3(.9,.95,.52),.035),cap(q,vec3(-1.0,.3,.5),vec3(-1.0,.95,.55),.035));
    float seat=rbox(p-vec3(-.72,.42,0.),vec3(.1,.28,.48),.05);
    vec3 fw=p-vec3(1.18,-.36,0.);
    float wh=tor(fw,.2,.085);
    vec3 rw=q-vec3(-.72,-.36,.6);
    wh=min(wh,tor(rw,.2,.085));
    float lamp=sph(p-vec3(1.22,.26,0.),.09);
    vec2 r=vec2(body,2.);
    if(roof<r.x) r=vec2(roof,0.);
    if(pil<r.x) r=vec2(pil,0.);
    if(seat<r.x) r=vec2(seat,0.);
    if(wh<r.x) r=vec2(wh,4.);
    if(lamp<r.x) r=vec2(lamp,1.);
    return r;
  }
  if(uObj<2.5){
    float d=1e5;
    for(int i=0;i<3;i++){
      float fi=float(i);
      float y0=-.25+fi*.42, w=1.3-fi*.32, dz=.95-fi*.18, h=.62-fi*.05;
      float ax=abs(p.x)/w;
      float ys=y0+h*(1.-ax)+.16*pow(ax,6.);
      float slab=max(abs(p.y-ys)*.78-.035,max(abs(p.x)-w,abs(p.z)-dz));
      d=min(d,slab);
      float gable=max(abs(abs(p.z)-dz+.05)-.03,max(p.y-ys+.02,y0-p.y));
      gable=max(gable,abs(p.x)-w*.9);
      d=min(d,gable);
      vec3 c=vec3(0.,y0+h,dz); vec3 cq=vec3(p.x,p.y,abs(p.z));
      d=min(d,cap(cq,c,c+vec3(0.,.22,.16),.03));
    }
    float wall=rbox(p-vec3(0.,-.7,0.),vec3(1.0,.45,.75),.03);
    vec2 r=vec2(d,2.);
    if(wall<r.x) r=vec2(wall,0.);
    return r;
  }
  if(uObj<3.5){
    vec3 n=p; n.z+=.06*sin(n.x*2.2+.5);
    float note=rbox(n,vec3(1.35,.66,.012),.02);
    return vec2(note,3.);
  }
  if(uObj<4.5){
    vec2 r2=vec2(length(p.xz),p.y);
    float R=.34+.012*sin(p.y*32.);
    R=mix(R,.13,smoothstep(.25,.62,p.y));
    R=mix(R,.15,step(.8,p.y));
    float d=max(r2.x-R,abs(p.y-.04)-.94)*.85;
    return vec2(d,0.);
  }
  if(uObj<5.5){
    vec2 r2=vec2(length(p.xz),p.y);
    float R=.46+.06*(p.y+.6);
    float glass=max(abs(r2.x-R)-.02,abs(p.y+.0)-.62);
    glass=min(glass,max(r2.x-R,abs(p.y+.6)-.04));
    float ice=1e5;
    for(int i=0;i<5;i++){
      float fi=float(i);
      vec3 c=p-vec3(.2*sin(fi*2.4),-.3+fi*.17,.2*cos(fi*2.4));
      c.xy*=rot(fi*1.3); c.yz*=rot(fi*.7);
      float tube=max(length(c.xz)-.13,abs(c.y)-.12);
      tube=max(tube,-(length(c.xz)-.045));
      ice=min(ice,tube);
    }
    vec2 r=vec2(glass,5.);
    if(ice<r.x) r=vec2(ice,1.);
    return r;
  }
  if(uObj<6.5){
    float table=rbox(p-vec3(0.,-.45,0.),vec3(1.1,.05,.6),.02);
    table=min(table,cap(q,vec3(1.,-.45,.5),vec3(1.,-1.,.5),.03));
    table=min(table,cap(q,vec3(-1.,-.45,.5),vec3(-1.,-1.,.5),.03));
    vec3 cp=p-vec3(0.,.9,0.);
    float can=max(abs(length(cp.xz)*.55+cp.y*1.)-.02,cp.y+.0);
    can=max(can,length(cp.xz)-1.25);
    can=min(can,cap(p,vec3(0.,-.45,0.),vec3(0.,.9,0.),.025));
    float goods=1e5;
    for(int i=0;i<4;i++){ float fi=float(i); goods=min(goods,rbox(p-vec3(-.75+fi*.5,-.28,.05*sin(fi*3.)),vec3(.18,.12,.35),.05)); }
    float bulbs=1e5;
    for(int i=0;i<4;i++){ float a=float(i)*1.5708+.6; bulbs=min(bulbs,sph(p-vec3(cos(a)*.9,.3,sin(a)*.9),.06)); }
    vec2 r=vec2(table,2.);
    if(can<r.x) r=vec2(can,2.);
    if(goods<r.x) r=vec2(goods,0.);
    if(bulbs<r.x) r=vec2(bulbs,1.);
    return r;
  }
  float d=smin(rbox(p,vec3(.55),.12),sph(p-vec3(0.,.6,0.),.4),.2);
  return vec2(d,0.);
}
vec3 nor(vec3 p){vec2 e=vec2(.003,-.003);return normalize(e.xyy*objMap(p+e.xyy).x+e.yyx*objMap(p+e.yyx).x+e.yxy*objMap(p+e.yxy).x+e.xxx*objMap(p+e.xxx).x);}
void main(){
  vec2 uv=(gl_FragCoord.xy/uRes)*2.-1.; uv.x*=uRes.x/uRes.y;
  vec3 ro=vec3(0.,uTilt*3.6,3.6);
  vec3 fw=normalize(vec3(0.,.05,0.)-ro), rt=normalize(cross(fw,vec3(0.,1.,0.))), up=cross(rt,fw);
  vec3 rd=normalize(fw*1.75+(rt*uv.x+up*uv.y)*.72);
  vec3 oc=ro; float b=dot(oc,rd), c=dot(oc,oc)-2.2*2.2, h=b*b-c;
  if(h<0.){gl_FragColor=vec4(0.);return;}
  float t=max(0.,-b-sqrt(h)), tmax=-b+sqrt(h);
  vec2 m=vec2(0.); bool hit=false;
  for(int i=0;i<80;i++){ m=objMap(ro+rd*t); if(m.x<.0015){hit=true;break;} t+=m.x*.85; if(t>tmax)break; }
  if(!hit){gl_FragColor=vec4(0.);return;}
  vec3 p=ro+rd*t, n=nor(p);
  vec3 l=normalize(vec3(.35,.7,.6));
  float dif=max(dot(n,l),0.);
  float ao=clamp(objMap(p+n*.1).x/.1,0.,1.);
  float rim=pow(1.-max(dot(n,-rd),0.),3.)*.4;
  float lum=(pow(dif,1.2)*.85+.12)*(.5+.5*ao)+rim*.5;
  vec3 lp=p; lp.xz*=rot(uYaw);
  if(m.y>.5&&m.y<1.5) lum=lum*.7+.35;
  if(m.y>1.5&&m.y<2.5) lum*=.85+.15*sin(lp.x*30.+lp.y*20.);
  if(m.y>2.5&&m.y<3.5){
    vec2 s=lp.xy;
    float border=step(1.22,abs(s.x))+step(.55,abs(s.y));
    float g=.5+.5*sin(length(s-vec2(-.55,.05))*70.);
    float emb=smoothstep(.4,.38,length(s-vec2(.55,.02)))*(.5+.5*sin(atan(s.y-.02,s.x-.55)*12.)*sin(length(s-vec2(.55,.02))*40.));
    vec2 dpos=s-vec2(-.85,.35);
    float num=max(digit1(dpos+vec2(.13,0.)),max(digit0(dpos),digit0(dpos-vec2(.17,0.))));
    float pat=clamp(.35*g+.6*emb+.9*num+.5*border,0.,1.);
    lum=(.2+.8*pat)*(.45+.55*dif)+rim*.3;
  }
  if(m.y>3.5&&m.y<4.5) lum*=.45;
  if(m.y>4.5&&m.y<5.5) lum=.12+rim*1.6+pow(max(dot(reflect(rd,n),l),0.),30.);
  if(uObj>3.5&&uObj<4.5){
    float lab=step(-.3,lp.y)*step(lp.y,.05);
    lum=mix(.18+rim*1.4,.55*(.5+.5*dif),lab);
    lum+=step(.8,lp.y)*.3;
  }
  gl_FragColor=vec4(clamp(lum*1.25,0.,1.),clamp((5.6-t)/2.6,0.,1.),0.,1.);
}`;

// ---------------------------------------------------------------- street scenes (2D layers)
export const SCENE_FS = `${FS_HEAD}
uniform vec2 uRes;
uniform float uPlace; // 0 food, 1 taxi, 2 hotel, 3 market, 4 bar, 5 pharmacy
uniform float uT;
uniform sampler2D uSign;
uniform vec4 uSignRect; // centre x, centre y, half w, half h (scene units)
${COMMON}
float box2(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,d.y),0.);}
float seg2(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
float fill(float d){return smoothstep(.006,-.006,d);}
float line(float d,float w){return smoothstep(w,w*.3,d);}
float L,D,M;
void put(float a,float lum,float dep){ if(a>.01){ L=mix(L,lum,a); D=mix(D,dep,a); M=max(M,a);} }
float bulbs(vec2 p,float y,float x0,float x1,float n){
  float s=(x1-x0)/n; float c=0.;
  vec2 q=vec2(mod(p.x-x0,s)-s*.5,p.y-y-.03*sin(floor((p.x-x0)/s)*1.7));
  if(p.x>x0&&p.x<x1) c=smoothstep(.028,.012,length(q));
  return c;
}
void mid(vec2 p){
  float pl=uPlace;
  if(pl<.5){ // food stall
    put(fill(box2(p-vec2(0.,-.38),vec2(.78,.2))),.32,.55);
    put(fill(box2(p-vec2(0.,-.24),vec2(.6,.07))),.85,.56);
    float aw=box2(p-vec2(0.,.05),vec2(.9,.09));
    float sc=p.y+.04-.03*abs(sin(p.x*18.));
    put(fill(max(aw,-sc))*(.6+.4*step(.5,fract(p.x*5.))),.55,.5);
    put(bulbs(p,-.08,-.85,.85,7.),1.,.6);
    float steam=smoothstep(.12,.0,abs(p.x-.35-.05*sin(p.y*12.+uT*2.)))*smoothstep(-.2,.0,p.y)*smoothstep(.25,.0,p.y)*.5;
    put(steam*(.5+.5*noise(p.y*20.-uT*3.)),.6,.58);
    for(int i=0;i<3;i++){ float fi=float(i); vec2 s=p-vec2(-.6+fi*.6,-.78); put(fill(box2(s-vec2(0.,.06),vec2(.11,.03))),.5,.85); put(line(abs(s.x)-.08,.012)*step(s.y,.05)*step(-.06,s.y),.35,.85); }
  } else if(pl<1.5){ // taxi rank
    vec2 c=p-vec2(.2,-.52);
    put(fill(box2(c,vec2(.85,.14))-.05),.4,.62);
    put(fill(box2(c-vec2(-.05,.2),vec2(.48,.1))-.05),.25,.6);
    put(fill(box2(c-vec2(-.05,.2),vec2(.42,.07))-.03),.55,.6);
    put(fill(box2(c-vec2(-.05,.36),vec2(.16,.04))),1.,.6);
    put(fill(length(c-vec2(-.5,-.15))-.12),.15,.66); put(fill(length(c-vec2(.45,-.15))-.12),.15,.66);
    put(fill(length(c-vec2(.86,.0))-.05),1.,.64);
    put(line(abs(p.x+.95),.015)*step(p.y,.2),.4,.5);
  } else if(pl<2.5){ // hotel desk entrance
    put(fill(box2(p-vec2(0.,-.15),vec2(1.1,.5))),.18,.4);
    for(int i=0;i<4;i++){ float fi=float(i); put(fill(box2(p-vec2(-.33+fi*.22,-.35),vec2(.09,.3))),.75+.1*sin(fi*3.),.42); }
    put(fill(max(box2(p-vec2(0.,.05),vec2(.7,.06)),-(p.y-.0))),.6,.5);
    put(fill(length(p-vec2(-.85,-.62))-.12),.3,.7); put(fill(length(p-vec2(.85,-.62))-.12),.3,.7);
    put(bulbs(p,.0,-.65,.65,6.),.9,.52);
  } else if(pl<3.5){ // market
    for(int i=0;i<3;i++){
      float fi=float(i); vec2 c=p-vec2(-.95+fi*.95,.02);
      float um=max(length(c*vec2(1.,2.2))-.45,-c.y);
      put(fill(um)*(.55+.45*step(.5,fract(atan(c.y,c.x)*2.))),.5,.5);
      put(line(abs(c.x),.01)*step(c.y,.0)*step(-.6,c.y),.3,.5);
      put(bulbs(c,-.02,-.4,.4,3.),1.,.55);
      for(int k=0;k<6;k++){ float fk=float(k); put(fill(box2(c-vec2(-.3+fk*.12,-.32),vec2(.035,.17))),.3+.3*hash(vec2(fi,fk)),.56); }
    }
    put(fill(box2(p-vec2(0.,-.62),vec2(1.4,.05))),.4,.6);
  } else if(pl<4.5){ // bar
    put(fill(box2(p-vec2(0.,-.1),vec2(1.,.55))),.08,.38);
    put(line(abs(box2(p-vec2(0.,-.05),vec2(.82,.4))-.02),.012),1.,.42);
    vec2 g=p-vec2(.55,.12); float cg=min(seg2(g,vec2(-.12,.12),vec2(0.,0.)),seg2(g,vec2(.12,.12),vec2(0.,0.)));
    cg=min(cg,min(seg2(g,vec2(-.12,.12),vec2(.12,.12)),seg2(g,vec2(0.,0.),vec2(0.,-.14))));
    put(line(cg,.012),1.,.43);
    for(int i=0;i<9;i++){ float fi=float(i); put(fill(box2(p-vec2(-.6+fi*.09,.0),vec2(.018,.06+.02*hash(vec2(fi,2.))))),.6+.4*step(.7,hash(vec2(fi,floor(uT*2.)))),.4); }
    put(fill(box2(p-vec2(0.,-.42),vec2(.95,.06))),.45,.6);
    for(int i=0;i<4;i++){ float fi=float(i); vec2 s=p-vec2(-.6+fi*.4,-.62); put(fill(length(s*vec2(1.,3.))-.08),.45,.75); put(line(abs(s.x),.01)*step(s.y,.0)*step(-.3,s.y),.35,.75); }
  } else { // pharmacy
    put(fill(box2(p-vec2(-.1,-.25),vec2(.9,.4))),.15,.42);
    for(int i=0;i<4;i++) for(int k=0;k<3;k++){ float fi=float(i),fk=float(k); put(fill(box2(p-vec2(-.65+fi*.36,-.45+fk*.2),vec2(.15,.06))),.35+.4*hash(vec2(fi,fk)),.44); }
    vec2 c=p-vec2(1.05,.2);
    float cr=min(box2(c,vec2(.16,.05)),box2(c,vec2(.05,.16)));
    put(fill(cr),1.,.5);
    put(line(abs(cr-.05),.01),.6,.5);
  }
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 p=vec2((uv.x-.5)*2.*uRes.x/uRes.y,uv.y*2.-1.);
  L=0.; D=0.; M=0.;
  // far skyline with windows
  float bx=floor(p.x*4.+10.), bh=.1+.45*hash(vec2(bx,3.));
  if(p.y<bh-.05&&p.y>-.6){
    vec2 w=vec2(fract(p.x*16.),fract(p.y*18.)); float lit=step(.62,hash(floor(vec2(p.x*16.,p.y*18.))+uPlace));
    put(1.,.05+.3*lit*step(w.x,.5)*step(w.y,.5),.12);
  }
  // overhead power lines
  for(int i=0;i<4;i++){ float fi=float(i); float y=.62+fi*.07-.16*(1.-pow(p.x/1.9,2.))+.02*sin(fi*5.); put(line(abs(p.y-y),.007),.3,.5+fi*.03); }
  put(line(abs(p.x+1.3),.016)*step(p.y,.95),.35,.55);
  // ground
  if(p.y<-.62){ float g=(-.62-p.y)/.38; put(1.,.04+.03*step(.5,fract(p.x*3.-g*6.)),.6+.4*g); }
  mid(p);
  // reflection on the wet street
  if(p.y<-.62){ float sL=L,sD=D,sM=M; vec2 r=vec2(p.x,-1.24-p.y); L=0.;D=0.;M=0.; mid(r); float rl=L*.28*M; L=max(sL,rl); D=sD; M=max(sM,M*.3); }
  // the sign, in Thai
  vec2 sp=(p-uSignRect.xy)/uSignRect.zw;
  if(abs(sp.x)<1.&&abs(sp.y)<1.){
    float tx=texture2D(uSign,vec2(sp.x*.5+.5,.5-sp.y*.5)).r;
    float edge=step(.9,max(abs(sp.x),abs(sp.y)));
    put(1.,mix(.16,1.,max(tx,edge*.5)),.48);
  }
  gl_FragColor=vec4(clamp(L,0.,1.),D,0.,M);
}`;

// ---------------------------------------------------------------- dot cloud (grid of points sampling a source texture)
export const CLOUD_VS = `
precision highp float;
attribute vec3 aG;          // u, v, seed
uniform sampler2D uA; uniform sampler2D uB;
uniform vec4 uRA; uniform vec4 uRB;   // sub-rect of each texture: x, y, w, h (h may be negative to flip)
uniform float uMix;
uniform float uT; uniform float uN; uniform float uAsp;   // time, rows, content aspect (x span)
uniform float uG;                     // row-tear amount
uniform vec2 uDepth;                  // depth offset, depth scale
uniform vec3 uRot;                    // yaw, pitch, roll
uniform vec4 uXf;                     // offset xyz, scale
uniform vec2 uFit;                    // screen scale
uniform float uPt;                    // dot size in px at z = 0
uniform float uClar;                  // clarity 0..1
uniform float uDis;                   // dissolve 0..1
uniform float uGat;                   // gather 0..1 (1 formed)
uniform float uKeep;                  // hand outlasts dissolve
uniform vec4 uP0; uniform vec4 uP1; uniform vec4 uP2;   // touch: x, y (clip space), amp, radius
uniform vec4 uVoice;                  // band y, amp, width, unused
uniform float uLo;                    // mask threshold
uniform float uGain;                  // brightness gain
uniform vec2 uPar;                    // parallax x shift by depth, unused
uniform float uGhost;                 // >0 when drawing the ghost (previous frame)
uniform float uFoot;                  // 1: fade the bottom of a bust out softly (people)
uniform float uFloor;                 // portraits: least share of dots kept in dark areas (hair, the shadow side)
uniform vec2 uSlope;                  // depth slope where dots start and finish thinning out
uniform vec2 uFootR;                  // where the bust starts and finishes fading out (rows, 0 top .. 1 bottom)
uniform float uStable;                // 1: which dots show does not reshuffle over time (crisp portraits)
varying float vL; varying float vLine; varying float vW;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(hash(vec2(i,7.)),hash(vec2(i+1.,7.)),f);}
vec2 push(vec2 s,vec4 P){ vec2 d=s-P.xy; d.x*=uFit.y/uFit.x; float r=length(d); float k=P.z*exp(-r*r/(P.w*P.w)); return r>1e-4? d/r*k*P.w*.85 : vec2(0.); }
void main(){
  vec4 sA=texture2D(uA,uRA.xy+aG.xy*uRA.zw);
  vec4 sB=texture2D(uB,uRB.xy+aG.xy*uRB.zw);
  float seed=aG.z;
  float m=smoothstep(seed*.55,seed*.55+.45,uMix);
  vec4 s=mix(sA,sB,m);
  float l=s.r*uGain, d=s.g, sp=s.b, mk=s.a;
  // where the surface drops away steeply (the edge of the face, the jaw onto the neck) the dots would
  // pile up into a bright rim or streaks, so they thin out there; the bottom of a bust fades out softly
  vec2 eu=vec2(1./256.,0.), ev=vec2(0.,1./256.);
  float gx=texture2D(uA,uRA.xy+(aG.xy+eu)*uRA.zw).g-texture2D(uA,uRA.xy+(aG.xy-eu)*uRA.zw).g;
  float gy=texture2D(uA,uRA.xy+(aG.xy+ev)*uRA.zw).g-texture2D(uA,uRA.xy+(aG.xy-ev)*uRA.zw).g;
  float level=(1.-smoothstep(uSlope.x,uSlope.y,length(vec2(gx,gy))))*(1.-uFoot*smoothstep(uFootR.x,uFootR.y,aG.y));
  float row=floor(aG.y*uN);
  float burst=step(.8,noise(uT*1.6+row*.02))*noise(uT*9.+row*.31);
  float band=step(.84,noise(row*.09+floor(uT*5.)*3.1));
  float off=(burst*.5+band*.22*noise(uT*13.+row))*uG;
  float broken=1.-uClar;
  off+=broken*.5*(hash(vec2(row,floor(uT*2.)))-.5)*step(.55,hash(vec2(row*.37,floor(uT*1.3))));
  vec3 p=vec3((aG.x-.5)*2.*uAsp,(.5-aG.y)*2.,(d-uDepth.x)*uDepth.y);
  // voice tear: rows near the band shift along the pitch
  float vb=1.-smoothstep(0.,uVoice.z,abs(p.y-uVoice.x));
  off+=vb*uVoice.y*(.12+.3*hash(vec2(row,floor(uT*24.))))*(hash(vec2(row,7.))>.5?1.:-1.);
  // expression flow: a small lift while dots change over
  float flow=4.*m*(1.-m)*step(.001,uMix)*step(uMix,.999);
  p.xy+=flow*.05*vec2(hash(aG.xy*41.)-.5,hash(aG.xy*67.)-.5);
  float cy=cos(uRot.x),sy=sin(uRot.x),cx=cos(uRot.y),sx=sin(uRot.y);
  p=vec3(p.x*cy+p.z*sy,p.y,-p.x*sy+p.z*cy);
  p=vec3(p.x,p.y*cx-p.z*sx,p.y*sx+p.z*cx);
  float cr=cos(uRot.z),sr=sin(uRot.z); p.xy=vec2(p.x*cr-p.y*sr,p.x*sr+p.y*cr);
  p.x+=uPar.x*p.z;
  p.x+=off;
  float h1=hash(aG.xy*91.+.3), h2=hash(aG.xy*57.+3.);
  // gather: loose dots swarm in from a wide ring
  float g=smoothstep(seed*.5,seed*.5+.5,uGat);
  float a=h1*6.2832, rr=1.6+1.9*h2;
  vec3 st=vec3(cos(a)*rr*max(1.,uAsp),sin(a)*rr,(h1-.5)*2.);
  float sw=(1.-g)*2.4*(h2-.5);
  vec2 sp2=vec2(p.x*cos(sw)-p.y*sin(sw),p.x*sin(sw)+p.y*cos(sw));
  p=mix(st,vec3(sp2,p.z),g*g*(3.-2.*g));
  // dissolve: dots lift and scatter; the hand (special) lasts longer
  float dis=uDis*(1.-uKeep*sp);
  p.y+=dis*dis*(h1*.9+.1); p.x+=dis*(h2-.5)*.5; p.z+=dis*(h1-.5)*.6;
  p=p*uXf.w+uXf.xyz;
  // the mask edge, the slopes and the foot thin the dots out gradually instead of cutting a hard outline
  // the cut-out's own edge carries a light halo: read the mask a few texels in, so the outline goes
  float mE=min(min(texture2D(uA,uRA.xy+(aG.xy+3.*eu)*uRA.zw).a,texture2D(uA,uRA.xy+(aG.xy-3.*eu)*uRA.zw).a),
              min(texture2D(uA,uRA.xy+(aG.xy+3.*ev)*uRA.zw).a,texture2D(uA,uRA.xy+(aG.xy-3.*ev)*uRA.zw).a));
  float keep=smoothstep(uLo,uLo+.3,mk)*mix(1.,smoothstep(uLo,uLo+.4,mE),uFoot)*level;
  float th=hash(aG.xy*uN+floor(uT*4.)*.37*(1.-uStable))*.85+.05;
  float on=step(th,max(pow(l,1.15)*1.15,uFloor))*step(hash(aG.xy*23.+1.7)*.97,keep);
  on*=step(h2,1.-dis*1.05);
  on*=step(seed,.25+.75*uClar);
  on*=step(.02,g);
  float zc=3.6-p.z; float f=3.27;
  vec2 scr=p.xy*f/zc*uFit;
  scr+=push(scr,uP0)+push(scr,uP1)+push(scr,uP2);
  vL=l*(.45+.55*uClar)*(1.-uGhost*.45);
  vW=sp*.6;
  vLine=step(.985,hash(vec2(row,floor(uT*3.))))*step(.5,uClar);
  gl_Position=vec4(scr,0.,1.);
  gl_PointSize=on>.5? uPt*uXf.w*(3.6/zc)*(.65+.35*uClar) : 0.;
  if(on<.5) gl_Position=vec4(2.,2.,2.,1.);
}`;

export const DOT_FS = `
precision mediump float;
uniform vec3 uC; uniform float uAlpha;
varying float vL; varying float vLine; varying float vW;
void main(){
  vec2 pc=gl_PointCoord-.5;
  float r=mix(length(pc),abs(pc.y),vLine);
  float a=smoothstep(.5,.2,r);
  if(a<.01) discard;
  vec3 col=uC*(.42+.8*vL)+mix(uC,vec3(1.),.3+.5*vW)*vL*vL*(.35+vW);
  col*=a*uAlpha*min(1.,vL*2.+.2);
  gl_FragColor=vec4(col,max(col.r,max(col.g,col.b)));
}`;

// ---------------------------------------------------------------- particles (words, letters, links, face to word)
export const PART_VS = `
precision highp float;
attribute vec4 aFrom;   // x, y, z, brightness
attribute vec4 aTo;     // x, y, z, brightness
attribute vec4 aM;      // delay, duration, seed, fade (1 fade out, -1 fade in)
uniform float uT; uniform float uN; uniform float uG;
uniform vec4 uXf; uniform vec2 uFit; uniform float uPt;
uniform float uStr;     // strength: 0 thin and torn .. 1 solid
uniform float uSwirl;
uniform vec3 uRot;
uniform vec4 uP0; uniform vec4 uP1; uniform vec4 uP2;
uniform float uTw;      // twinkle amount
varying float vL; varying float vLine; varying float vW;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(hash(vec2(i,7.)),hash(vec2(i+1.,7.)),f);}
vec2 push(vec2 s,vec4 P){ vec2 d=s-P.xy; d.x*=uFit.y/uFit.x; float r=length(d); float k=P.z*exp(-r*r/(P.w*P.w)); return r>1e-4? d/r*k*P.w*.85 : vec2(0.); }
void main(){
  float seed=aM.z;
  float e=clamp((uT-aM.x)/max(aM.y,.001),0.,1.);
  float k=e*e*(3.-2.*e);
  vec3 p=mix(aFrom.xyz,aTo.xyz,k);
  float arc=sin(3.1416*k);
  p.xy+=arc*uSwirl*vec2(hash(vec2(seed,1.))-.5,hash(vec2(seed,2.))-.5);
  p.z+=arc*uSwirl*.5*(hash(vec2(seed,3.))-.5);
  float l=mix(aFrom.w,aTo.w,k);
  float alive=1.;
  if(aM.w>.5) alive=1.-smoothstep(.2,.9,e);
  if(aM.w<-.5) alive=smoothstep(.0,.6,e);
  float row=floor((.5-p.y*.5)*uN);
  float torn=1.-uStr;
  float off=torn*.35*(hash(vec2(row,floor(uT*1.5)))-.5)*step(.5,hash(vec2(row*.7,floor(uT*.8))));
  float burst=step(.82,noise(uT*1.6+row*.02))*noise(uT*9.+row*.31);
  off+=burst*.3*uG;
  float cy=cos(uRot.x),sy=sin(uRot.x); p=vec3(p.x*cy+p.z*sy,p.y,-p.x*sy+p.z*cy);
  float cx=cos(uRot.y),sx=sin(uRot.y); p=vec3(p.x,p.y*cx-p.z*sx,p.y*sx+p.z*cx);
  p.x+=off;
  p=p*uXf.w+uXf.xyz;
  float on=step(seed,.3+.7*uStr)*step(.01,alive);
  float th=hash(vec2(seed*31.,floor(uT*10.)))*uTw;
  on*=step(th,l+.05);
  float zc=3.6-p.z; float f=3.27;
  vec2 scr=p.xy*f/zc*uFit;
  scr+=push(scr,uP0)+push(scr,uP1)+push(scr,uP2);
  vL=l*alive*(.5+.5*uStr);
  vW=arc*.8+max(0.,1.-abs(e-.97)*12.)*step(e,.999)*.0;
  vLine=0.;
  gl_Position=vec4(scr,0.,1.);
  gl_PointSize=on>.5? uPt*uXf.w*(3.6/zc)*(.55+.45*uStr) : 0.;
  if(on<.5) gl_Position=vec4(2.,2.,2.,1.);
}`;
