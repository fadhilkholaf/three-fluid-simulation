// https://mofu-dev.com/en/blog/stable-fluids/

import * as THREE from "three";

import faceVert from "./shaders/face.vert";
import mouseVert from "./shaders/mouse.vert";

import advectionFrag from "./shaders/advection.frag";
import colorFrag from "./shaders/color.frag";
import divergenceFrag from "./shaders/pressure.frag";
import externalForceFrag from "./shaders/externalForce.frag";
import poissonFrag from "./shaders/poisson.frag";
import pressureFrag from "./shaders/pressure.frag";
import viscousFrag from "./shaders/viscous.frag";

let main = () => {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.autoClear = false;
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000);
  renderer.setPixelRatio(window.devicePixelRatio);

  let scene = new THREE.Scene();

  let camera = new THREE.Camera();

  let canvas = renderer.domElement;

  // ======
  // START FLUID VARIABLE
  // ======

  const viscousIterations = 8;
  const poissonIterations = 8;
  let mouseForce = 256;
  let resolution = 1;
  let cursorSize = 64;
  let viscous = 2048;
  let dt = 0.016;
  let BFECC = true;

  let width = Math.round(resolution * window.innerWidth);
  let height = Math.round(resolution * window.innerHeight);

  let cellScale = new THREE.Vector2(1.0 / width, 1.0 / height);
  let fboSize = new THREE.Vector2(width, height);
  let boundarySpace = new THREE.Vector2().copy(cellScale);

  let vel_0 = new THREE.WebGLRenderTarget(fboSize.x, fboSize.y, {
    type: THREE.FloatType,
  });
  let vel_1 = new THREE.WebGLRenderTarget(fboSize.x, fboSize.y, {
    type: THREE.FloatType,
  });
  let vel_viscous0 = new THREE.WebGLRenderTarget(fboSize.x, fboSize.y, {
    type: THREE.FloatType,
  });
  let vel_viscous1 = new THREE.WebGLRenderTarget(fboSize.x, fboSize.y, {
    type: THREE.FloatType,
  });
  let div = new THREE.WebGLRenderTarget(fboSize.x, fboSize.y, {
    type: THREE.FloatType,
  });
  let pressure_0 = new THREE.WebGLRenderTarget(fboSize.x, fboSize.y, {
    type: THREE.FloatType,
  });
  let pressure_1 = new THREE.WebGLRenderTarget(fboSize.x, fboSize.y, {
    type: THREE.FloatType,
  });

  let coords = new THREE.Vector2();
  let coords_old = new THREE.Vector2();
  let diff = new THREE.Vector2();

  // ======
  // END FLUID VARIABLE
  // ======

  // ======
  // START CODE HERE
  // ======

  let advection = () => {
    let advectionScene = new THREE.Scene();
    let advectionCamera = new THREE.Camera();

    let advectionGeometry = new THREE.PlaneGeometry(2, 2);
    let advectionMaterial = new THREE.RawShaderMaterial({
      vertexShader: faceVert,
      fragmentShader: advectionFrag,
      uniforms: {
        boundarySpace: {
          value: cellScale,
        },
        px: {
          value: cellScale,
        },
        fboSize: {
          value: fboSize,
        },
        velocity: {
          value: vel_0.texture,
        },
        dt: {
          value: dt,
        },
        isBFECC: {
          value: BFECC,
        },
      },
    });

    let advectionMesh = new THREE.Mesh(advectionGeometry, advectionMaterial);

    advectionScene.add(advectionMesh);

    renderer.setRenderTarget(vel_1);
    renderer.render(advectionScene, advectionCamera);
    renderer.setRenderTarget(null);
  };

  let mouse = () => {
    let setCoords = (x: number, y: number) => {
      coords.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    };

    diff.subVectors(coords, coords_old);
    coords_old.copy(coords);

    if (coords_old.x === 0 && coords_old.y === 0) diff.set(0, 0);

    window.addEventListener("mousemove", (e) =>
      setCoords(e.clientX, e.clientY)
    );
    window.addEventListener("touchmove", (e) =>
      setCoords(e.touches[0].clientX, e.touches[0].clientY)
    );
  };

  let externalForce = () => {
    let externalForceScene = new THREE.Scene();
    let externalForceCamera = new THREE.Camera();

    let externalForceGeometry = new THREE.PlaneGeometry(2, 2);
    let externalForceMaterial = new THREE.RawShaderMaterial({
      vertexShader: mouseVert,
      fragmentShader: externalForceFrag,
      blending: THREE.AdditiveBlending,
      uniforms: {
        px: {
          value: cellScale,
        },
        force: {
          value: new THREE.Vector2(0.0, 0.0),
        },
        center: {
          value: new THREE.Vector2(0.0, 0.0),
        },
        scale: {
          value: new THREE.Vector2(cursorSize, cursorSize),
        },
      },
    });

    let externalForceMesh = new THREE.Mesh(
      externalForceGeometry,
      externalForceMaterial
    );

    externalForceScene.add(externalForceMesh);

    let forceX = (diff.x / 2) * mouseForce;
    let forceY = (diff.y / 2) * mouseForce;

    let cursorSizeX = cursorSize * cellScale.x;
    let cursorSizeY = cursorSize * cellScale.y;

    let centerX = Math.min(
      Math.max(coords.x, -1 + cursorSizeX + cellScale.x * 2),
      1 - cursorSizeX - cellScale.x * 2
    );
    let centerY = Math.min(
      Math.max(coords.y, -1 + cursorSizeY + cellScale.y * 2),
      1 - cursorSizeY - cellScale.y * 2
    );

    let uniforms = externalForceMaterial.uniforms;

    uniforms.force.value.set(forceX, forceY);
    uniforms.center.value.set(centerX, centerY);
    uniforms.scale.value.set(cursorSize, cursorSize);

    renderer.setRenderTarget(vel_1);
    renderer.render(externalForceScene, externalForceCamera);
    renderer.setRenderTarget(null);
  };

  let viscousFunction = () => {
    for (var i = 0; i < viscousIterations; i++) {
      let output = vel_viscous1;
      let output0 = vel_viscous0;
      let output1 = vel_viscous1;
      let fbo_in;
      let fbo_out;

      const viscousScene = new THREE.Scene();
      const viscousCamera = new THREE.Camera();

      const viscousGeometry = new THREE.PlaneGeometry(2, 2);
      const viscousMaterial = new THREE.RawShaderMaterial({
        vertexShader: faceVert,
        fragmentShader: viscousFrag,
        uniforms: {
          boundarySpace: { value: boundarySpace },
          velocity: { value: vel_1.texture },
          velocity_new: { value: vel_viscous0.texture },
          v: { value: viscous },
          px: { value: cellScale },
          dt: { value: dt },
        },
      });

      const viscousMesh = new THREE.Mesh(viscousGeometry, viscousMaterial);

      viscousScene.add(viscousMesh);

      if (i % 2 == 0) {
        fbo_in = output0;
        fbo_out = output1;
      } else {
        fbo_in = output1;
        fbo_out = output0;
      }

      viscousMesh.material.uniforms.velocity_new.value = fbo_in.texture;
      viscousMesh.material.uniforms.dt.value = dt;
      output = fbo_out;

      renderer.setRenderTarget(output);
      renderer.render(viscousScene, viscousCamera);
      renderer.setRenderTarget(null);
    }
  };

  let divergence = () => {
    let divergenceScene = new THREE.Scene();
    let divergenceCamera = new THREE.Camera();

    let divergenceGeometry = new THREE.PlaneGeometry(2, 2);
    let divergenceMaterial = new THREE.RawShaderMaterial({
      vertexShader: faceVert,
      fragmentShader: divergenceFrag,
      uniforms: {
        boundarySpace: {
          value: boundarySpace,
        },
        velocity: {
          value: vel_viscous0.texture,
        },
        px: {
          value: cellScale,
        },
        dt: {
          value: dt,
        },
      },
    });

    let divergenceMesh = new THREE.Mesh(divergenceGeometry, divergenceMaterial);

    divergenceScene.add(divergenceMesh);

    divergenceMesh.material.uniforms.velocity.value = vel_1;

    renderer.setRenderTarget(div);
    renderer.render(divergenceScene, divergenceCamera);
    renderer.setRenderTarget(null);
  };

  let poisson = () => {
    for (var i = 0; i < poissonIterations; i++) {
      let output = pressure_1;
      let output0 = pressure_0;
      let output1 = pressure_1;
      let p_in;
      let p_out;

      let poissonScene = new THREE.Scene();
      let poissonCamera = new THREE.Camera();

      let poissonGeometry = new THREE.PlaneGeometry(2, 2);
      let poissonMaterial = new THREE.RawShaderMaterial({
        vertexShader: faceVert,
        fragmentShader: poissonFrag,
        uniforms: {
          boundarySpace: {
            value: boundarySpace,
          },
          pressure: {
            value: pressure_0.texture,
          },
          poisson: {
            value: div.texture,
          },
          px: {
            value: cellScale,
          },
        },
      });

      let poissonMesh = new THREE.Mesh(poissonGeometry, poissonMaterial);

      poissonScene.add(poissonMesh);

      if (i % 2 == 0) {
        p_in = output0;
        p_out = output1;
      } else {
        p_in = output1;
        p_out = output0;
      }

      poissonMesh.material.uniforms.pressure.value = p_in.texture;
      output = p_out;

      renderer.setRenderTarget(output);
      renderer.render(poissonScene, poissonCamera);
      renderer.setRenderTarget(null);
    }
  };

  let pressure = () => {
    let pressureScene = new THREE.Scene();
    let pressureCamera = new THREE.Camera();

    let pressureGeometry = new THREE.PlaneGeometry(2, 2);
    let pressureMaterial = new THREE.RawShaderMaterial({
      vertexShader: faceVert,
      fragmentShader: pressureFrag,
      uniforms: {
        boundarySpace: {
          value: boundarySpace,
        },
        pressure: {
          value: pressure_0.texture,
        },
        velocity: {
          value: vel_viscous0.texture,
        },
        px: {
          value: cellScale,
        },
        dt: {
          value: dt,
        },
      },
    });

    let pressureMesh = new THREE.Mesh(pressureGeometry, pressureMaterial);

    pressureScene.add(pressureMesh);

    renderer.setRenderTarget(vel_0);
    renderer.render(pressureScene, pressureCamera);
    renderer.setRenderTarget(null);
  };

  // ======
  // END CODE HERE
  // ======

  let planeGeometry = new THREE.PlaneGeometry(2, 2);
  let planeShaderMaterial = new THREE.RawShaderMaterial({
    vertexShader: faceVert,
    fragmentShader: colorFrag,
    uniforms: {
      velocity: {
        value: vel_0.texture,
      },
      boundarySpace: {
        value: boundarySpace,
      },
    },
  });

  let planeShaderMesh = new THREE.Mesh(planeGeometry, planeShaderMaterial);

  scene.add(planeShaderMesh);

  let animate = () => {
    advection();
    mouse();
    externalForce();
    viscousFunction();
    divergence();
    poisson();
    pressure();

    renderer.render(scene, camera);
  };

  renderer.setAnimationLoop(animate);

  document.body.insertAdjacentElement("afterbegin", canvas);
};

main();
