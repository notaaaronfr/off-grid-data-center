// Steam over the cooling towers and diesel exhaust over the generator stacks.
// Each plume is a column of world-space haze anchored at its stack, leaning with a light wind that blows away
// from the viewer, so it rises into open sky and nothing drawn in the SVG ever has to sit in front of it.
// The column is sampled where the pixel's ray crosses the vertical plane through its (wind-bent) axis that faces
// the camera; its Gaussian cross-section integrates analytically along the ray, so no march is needed.
export const SHADER = `
uniform float uLight;
uniform float uSteam;
uniform float uRise;
uniform vec3 uSmoke;
uniform vec3 uPuff;
uniform vec3 uTower[3];
uniform vec3 uStack[3];
const vec2 WIND=vec2(-.30,-.20);

vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}

// x: density, y: tone (0 in its own shadow, 1 lit from the kit's light, which comes from screen left)
vec2 plume(vec3 p0,vec3 V,vec3 A,float r0,float grow,float height,float seed,float speed){
  vec2 n=vec2(uCam.y,uCam.x);
  vec2 side=vec2(uCam.x,-uCam.y);
  float vn=dot(V.xy,n);
  float t=dot(A.xy-p0.xy,n)/vn;
  float h=p0.z+t*V.z-A.z;
  t=dot(A.xy+WIND*max(h,0.)-p0.xy,n)/vn;
  vec3 p=p0+t*V;
  h=p.z-A.z;
  if(h<-1.||h>height*1.3)return vec2(0.);
  float s=r0+grow*max(h,0.);
  float u=dot(p.xy-A.xy-WIND*max(h,0.),side);
  if(abs(u)>3.2*s)return vec2(0.);
  float q=fbm3(vec3(u/(s*.85)+seed,h/(s*1.2)-uTime*speed,seed*1.7+uTime*.04));
  float body=exp(-u*u/(s*s*.5));
  float env=smoothstep(1.,9.,h)*(1.-smoothstep(height*.3,height*1.25,h));
  float d=body*env*max(0.,q*1.7-.38)*pow(r0/s,.6);
  float tone=clamp(.55+1.2*(q-.5)-.4*u/s+.2*h/height,0.,1.);
  return vec2(d,tone);
}

vec4 smoke(vec3 p0,vec3 V,vec3 A,float steady,float puff,float seed){
  if(steady+puff<.002)return vec4(0.);
  vec2 m=plume(p0,V,A,1.7+3.*puff,.45,30.+14.*puff,seed,.95);
  vec3 soot=mix(vec3(.40,.40,.41),vec3(.24,.24,.25),uLight);
  vec3 haze=mix(vec3(.50,.51,.53),vec3(.62,.63,.65),uLight);
  float share=puff/(puff+steady+1e-3);
  vec3 seen=mix(haze,soot,share)*mix(.86,1.08,m.y);
  float a=(1.-exp(-m.x*(steady*1.8+puff*5.)))*mix(.7,.9,share);
  return vec4(seen*a,a);
}

void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 V=towardViewer();
  vec3 p0=rayOf(vb);
  vec4 ink=vec4(0.);
  ink=over(smoke(p0,V,uStack[0],uSmoke.x,uPuff.x,3.1),ink);
  ink=over(smoke(p0,V,uStack[1],uSmoke.y,uPuff.y,5.7),ink);
  ink=over(smoke(p0,V,uStack[2],uSmoke.z,uPuff.z,8.9),ink);
  if(uSteam>.002){
    vec3 UNDER=mix(vec3(.30,.32,.35),vec3(.72,.76,.81),uLight);
    vec3 EDGE=mix(vec3(.42,.45,.49),vec3(.84,.87,.90),uLight);
    vec3 CROWN=mix(vec3(.58,.61,.65),vec3(.97,.975,.98),uLight);
    for(int i=0;i<3;i++){
      vec2 m=plume(p0,V,uTower[i],16.,.34,uRise,float(i)*7.3+1.,.3);
      float a=(1.-exp(-m.x*uSteam*4.2))*mix(.85,.94,uLight);
      vec3 seen=mix(UNDER,mix(EDGE,CROWN,smoothstep(.5,.9,m.y)),smoothstep(.05,.55,m.y));
      ink=over(vec4(seen*a,a),ink);
    }
  }
  ink.rgb=min(ink.rgb,vec3(ink.a));
  float nz=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  float gate=smoothstep(0.,1.5/255.,ink.a);
  ink=max(ink+vec4(vec3(nz),nz)*gate,0.);
  ink.rgb=min(ink.rgb,vec3(ink.a));
  gl_FragColor=ink;
}
`;
