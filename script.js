var scene, camera, renderer;

var mixers = [];
var clockAnimaciones = new THREE.Clock();

const POSICIONES_LAMPARAS = [
    { x: -14, y: 12.8, z:  0 },
    { x:  -4, y: 12.8, z:  4 },
    { x:  -4, y: 12.8, z: -4 },
    { x: -24, y: 12.8, z:  4 },
    { x: -24, y: 12.8, z: -4 },
];

var totalModelos = 0;
var modelosCargados = 0;
var progresoModelos = [];
var escenaLista = false;

// Objetos contra los que el personaje puede chocar. Se guarda el objeto
// real (no una caja envolvente) para poder entrar por puertas/huecos.
var objetosColisionables = [];
var raycasterColision = new THREE.Raycaster();

var arcangelCargado = false;
var modeloArcangel = null;
var arcangelInteractivo = false;
var modoArcangelActivo = false;

var juegoIniciado = false;
var transicionCamaraActiva = false;
var transicionCamaraProgreso = 0;
var transicionCamaraOrigen = null;
const DURACION_TRANSICION_CAMARA = 1.6;

var luzAmbiente, luzSol, luzRelleno;
var modoOscuro = false;

var sol;

var terrenoMesh = null;

var lucesLamparasSpot = [];

const CONFIG_LUZ = {
    dia: {
        ambiente: 0.03,
        sol: { color: 0xff7a3d, intensidad: 0.3 },
        relleno: { color: 0x1c2c4a, intensidad: 0.12 },
        exposicion: 0.5
    },
    oscuro: {
        ambiente: 0.005,
        sol: { color: 0x0f1524, intensidad: 0.02 },
        relleno: { color: 0x05080f, intensidad: 0.01 },
        exposicion: 0.08
    }
};

const VISTA_ARCANGEL = {
    distanciaCamara: 14,
    fraccionPantalla: 0.82,
    rotacionBase: Math.PI / -2,
    ajusteVertical: -0.5,
    fraccionLateral: 0
};

/* =========================================================
   UTILIDADES COMUNES
   ========================================================= */

// Blender exporta a veces materiales "BLEND" sin transparencia real, lo
// que rompe el orden de profundidad (objetos se ven a través de otros).
// Se fuerza a opaco cuando la opacidad es prácticamente 1.
function corregirMaterialSolido(material) {
    if (!material) return;
    const materiales = Array.isArray(material) ? material : [material];
    materiales.forEach(function (mat) {
        if (mat.transparent && mat.opacity >= 0.999) {
            mat.transparent = false;
        }
        mat.depthWrite = true;
        mat.depthTest = true;
    });
}

// Quita el desplazamiento horizontal "horneado" en el hueso raíz de la
// animación, dejando solo el rebote vertical. El avance real lo controla
// nuestro código, no la animación.
function quitarDesplazamientoHorizontal(clip) {
    clip.tracks.forEach(function (track) {
        if (track.isVectorKeyframeTrack && track.name.endsWith('.position')) {
            const valores = track.values;
            const xInicial = valores[0];
            const zInicial = valores[2];
            for (let i = 0; i < valores.length; i += 3) {
                valores[i] = xInicial;
                valores[i + 2] = zInicial;
            }
        }
    });
    return clip;
}

/* =========================================================
   PERSONAJE JUGABLE
   ========================================================= */

var personaje = null;
var mixerPersonaje = null;
var accionParado = null;
var accionComenzar = null;
var accionCaminando = null;
var accionActual = null;

var estadoPersonaje = 'idle';
var teclaW = false;
var teclaQ = false;

const ESCALA_PERSONAJE = { x: 0.02, y: 0.02, z: 0.02 };
const POSICION_INICIAL_PERSONAJE = { x: -55, z: 20 };
const VELOCIDAD_PERSONAJE = 6;

const ALTURA_RAYO_COLISION_TORSO = 1.4;
// Altura baja para detectar bordes de gradas sin chocar contra la
// contrahuella de cada peldaño (los escalones de la iglesia miden 0.3).
const ALTURA_RAYO_COLISION_BAJA = 0.4;
const ALTURAS_RAYOS_COLISION = [ALTURA_RAYO_COLISION_TORSO, ALTURA_RAYO_COLISION_BAJA];
const RADIO_COLISION_PERSONAJE = 1.0;
const ANGULOS_RAYOS_COLISION = [0, 0.35, -0.35, 0.7, -0.7];

// true si moverse en (dirX, dirZ) haría chocar al personaje contra algo.
function direccionBloqueada(dirX, dirZ, distanciaExtra) {
    if (objetosColisionables.length === 0) return false;
    if (dirX === 0 && dirZ === 0) return false;

    const distancia = RADIO_COLISION_PERSONAJE + (distanciaExtra || 0);
    const ejeArriba = new THREE.Vector3(0, 1, 0);

    for (let a = 0; a < ALTURAS_RAYOS_COLISION.length; a++) {
        const origen = new THREE.Vector3(
            personaje.position.x,
            personaje.position.y + ALTURAS_RAYOS_COLISION[a],
            personaje.position.z
        );

        for (let i = 0; i < ANGULOS_RAYOS_COLISION.length; i++) {
            const direccion = new THREE.Vector3(dirX, 0, dirZ)
                .normalize()
                .applyAxisAngle(ejeArriba, ANGULOS_RAYOS_COLISION[i]);

            raycasterColision.set(origen, direccion);
            raycasterColision.far = distancia;

            const impactos = raycasterColision.intersectObjects(objetosColisionables, true);
            if (impactos.length > 0) {
                return true;
            }
        }
    }

    return false;
}

// --- Altura del personaje (piso bajo los pies) ---
const raycasterSuelo = new THREE.Raycaster();
const ALTURA_ORIGEN_RAYO_SUELO = 50;
const DISTANCIA_MAXIMA_RAYO_SUELO = 200;
// Margen que permite subir un escalón/rampa por frame. Cualquier
// superficie golpeada por encima de (altura actual + margen) se ignora:
// así, al entrar por la puerta de la iglesia, el rayo no confunde el
// techo (mucho más arriba) con el piso real y el personaje ya no queda
// "teletransportado" encima del edificio en vez de adentro.
const MARGEN_ALTURA_SUELO = 1.2;

function actualizarAlturaPersonaje() {
    if (!personaje) return;

    const origen = new THREE.Vector3(
        personaje.position.x,
        personaje.position.y + ALTURA_ORIGEN_RAYO_SUELO,
        personaje.position.z
    );

    raycasterSuelo.set(origen, new THREE.Vector3(0, -1, 0));
    raycasterSuelo.far = DISTANCIA_MAXIMA_RAYO_SUELO;

    const objetivosSuelo = terrenoMesh
        ? objetosColisionables.concat([terrenoMesh])
        : objetosColisionables;

    const impactos = raycasterSuelo.intersectObjects(objetivosSuelo, true);

    // Los impactos vienen ordenados del más cercano al origen (más alto)
    // al más lejano. Se toma el primero que esté a la altura del
    // personaje o por debajo (+ margen), descartando techos/entrepisos
    // que queden por encima de donde el personaje realmente está parado.
    const alturaMaxima = personaje.position.y + MARGEN_ALTURA_SUELO;
    let impactoValido = null;
    for (let i = 0; i < impactos.length; i++) {
        if (impactos[i].point.y <= alturaMaxima) {
            impactoValido = impactos[i];
            break;
        }
    }

    if (impactoValido) {
        personaje.position.y = impactoValido.point.y;
    } else if (impactos.length > 0) {
        // Todos los impactos quedaron por encima (p. ej. recién entrando
        // bajo un techo bajo): se usa el más bajo de los detectados.
        personaje.position.y = impactos[impactos.length - 1].point.y;
    } else {
        personaje.position.y = calcularAlturaTerreno(personaje.position.x, personaje.position.z);
    }
}

const AJUSTE_ROTACION_PERSONAJE = Math.PI;

var luzPersonaje = null;

function cargarPersonaje() {
    const loader = new THREE.FBXLoader();

    loader.load(
        'personaje/parado.fbx',
        function (modelo) {
            modelo.scale.set(ESCALA_PERSONAJE.x, ESCALA_PERSONAJE.y, ESCALA_PERSONAJE.z);
            modelo.position.set(
                POSICION_INICIAL_PERSONAJE.x,
                calcularAlturaTerreno(POSICION_INICIAL_PERSONAJE.x, POSICION_INICIAL_PERSONAJE.z),
                POSICION_INICIAL_PERSONAJE.z
            );
            modelo.rotation.y = yawCamara + AJUSTE_ROTACION_PERSONAJE;

            modelo.traverse(function (child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    corregirMaterialSolido(child.material);
                }
                if (child.isLight) {
                    child.intensity *= 0;
                }
            });

            scene.add(modelo);
            personaje = modelo;

            mixerPersonaje = new THREE.AnimationMixer(modelo);
            mixers.push(mixerPersonaje);

            if (modelo.animations && modelo.animations.length > 0) {
                const clipParado = quitarDesplazamientoHorizontal(modelo.animations[0]);
                accionParado = mixerPersonaje.clipAction(clipParado);
                accionParado.play();
                accionActual = accionParado;
            }

            agregarLuzPersonaje();

            cargarAnimacionPersonaje('personaje/comenzar.fbx', function (clip) {
                quitarDesplazamientoHorizontal(clip);
                accionComenzar = mixerPersonaje.clipAction(clip);
                accionComenzar.setLoop(THREE.LoopOnce);
                accionComenzar.clampWhenFinished = true;
            });

            cargarAnimacionPersonaje('personaje/caminando.fbx', function (clip) {
                quitarDesplazamientoHorizontal(clip);
                accionCaminando = mixerPersonaje.clipAction(clip);
                accionCaminando.setLoop(THREE.LoopRepeat);
            });

            mixerPersonaje.addEventListener('finished', function (e) {
                if (e.action === accionComenzar && estadoPersonaje === 'comenzando') {
                    estadoPersonaje = 'caminando';
                    cambiarAnimacion(accionCaminando, 0.15);
                }
            });

            console.log('Personaje cargado correctamente.');
        },
        undefined,
        function (error) {
            console.error('❌ Error al cargar el personaje (parado.fbx):', error);
        }
    );
}

function cargarAnimacionPersonaje(archivo, callback) {
    const loader = new THREE.FBXLoader();
    loader.load(
        archivo,
        function (modelo) {
            if (modelo.animations && modelo.animations.length > 0) {
                callback(modelo.animations[0]);
            } else {
                console.warn('El archivo no contiene animaciones:', archivo);
            }
        },
        undefined,
        function (error) {
            console.error('❌ Error al cargar animación:', archivo, error);
        }
    );
}

function cambiarAnimacion(nuevaAccion, duracionFade) {
    if (!nuevaAccion || nuevaAccion === accionActual) return;
    duracionFade = (duracionFade !== undefined) ? duracionFade : 0.25;

    nuevaAccion.enabled = true;
    nuevaAccion.setEffectiveTimeScale(1);
    nuevaAccion.setEffectiveWeight(1);
    nuevaAccion.reset();
    nuevaAccion.play();

    if (accionActual && accionActual !== nuevaAccion) {
        accionActual.crossFadeTo(nuevaAccion, duracionFade, true);
    }

    accionActual = nuevaAccion;
}

function iniciarCaminata() {
    if (!personaje || !mixerPersonaje) return;
    if (estadoPersonaje !== 'idle') return;

    if (accionComenzar) {
        estadoPersonaje = 'comenzando';
        cambiarAnimacion(accionComenzar, 0.2);
    } else if (accionCaminando) {
        estadoPersonaje = 'caminando';
        cambiarAnimacion(accionCaminando, 0.2);
    }
}

function detenerCaminata() {
    if (!personaje || !mixerPersonaje) return;
    estadoPersonaje = 'idle';
    if (accionParado) {
        cambiarAnimacion(accionParado, 0.25);
    }
}

function init_controles_personaje() {
    window.addEventListener('keydown', function (e) {
        if (e.code === 'KeyW') {
            if (!teclaW) {
                teclaW = true;
                iniciarCaminata();
            }
        } else if (e.code === 'KeyQ') {
            if (!teclaQ) {
                teclaQ = true;
                iniciarCaminata();
            }
        }
    });

    window.addEventListener('keyup', function (e) {
        if (e.code === 'KeyW') {
            teclaW = false;
            if (!teclaQ) detenerCaminata();
        } else if (e.code === 'KeyQ') {
            teclaQ = false;
            if (!teclaW) detenerCaminata();
        }
    });
}

function actualizarPersonaje(delta) {
    if (!personaje || modoArcangelActivo || !juegoIniciado) return;

    personaje.rotation.y = yawCamara + AJUSTE_ROTACION_PERSONAJE;

    if (teclaQ) {
        // Modo "subir gradas": avanza en pendiente de 45° fija, sin pasar
        // por actualizarAlturaPersonaje (que lo devolvería hacia abajo).
        const forwardX = -Math.sin(yawCamara);
        const forwardZ = -Math.cos(yawCamara);
        const avanceSubida = VELOCIDAD_PERSONAJE * delta * Math.SQRT1_2;

        personaje.position.x += forwardX * avanceSubida;
        personaje.position.z += forwardZ * avanceSubida;
        personaje.position.y += avanceSubida;
    } else {
        if (teclaW) {
            const forwardX = -Math.sin(yawCamara);
            const forwardZ = -Math.cos(yawCamara);
            const avance = VELOCIDAD_PERSONAJE * delta;

            if (!direccionBloqueada(forwardX, forwardZ, avance)) {
                personaje.position.x += forwardX * avance;
                personaje.position.z += forwardZ * avance;
            } else if (!direccionBloqueada(forwardX, 0, avance)) {
                personaje.position.x += forwardX * avance;
            } else if (!direccionBloqueada(0, forwardZ, avance)) {
                personaje.position.z += forwardZ * avance;
            }
        }

        actualizarAlturaPersonaje();
    }

    actualizarLuzPersonaje();
}

function agregarLuzPersonaje() {
    luzPersonaje = new THREE.PointLight(0xfff2d9, 1.8, 12, 2);
    luzPersonaje.castShadow = false;
    scene.add(luzPersonaje);
    actualizarLuzPersonaje();
}

function actualizarLuzPersonaje() {
    if (!luzPersonaje || !personaje) return;
    luzPersonaje.position.set(
        personaje.position.x,
        personaje.position.y + 3,
        personaje.position.z
    );
}

/* =========================================================
   CÁMARA EN TERCERA PERSONA
   ========================================================= */

const CAMARA_TERCERA_PERSONA = {
    distancia: 7,
    altura: 3.5,
    alturaMira: 1.6,
    sensibilidadMouse: 0.0025,
    limitePitch: THREE.MathUtils.degToRad(60)
};

var yawCamara = 0;
var pitchCamara = THREE.MathUtils.degToRad(10);
var pointerLockActivo = false;

function init_camara_tercera_persona() {
    const el = renderer.domElement;

    el.addEventListener('click', function () {
        if (juegoIniciado && !arcangelInteractivo) {
            el.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', function () {
        pointerLockActivo = (document.pointerLockElement === el);
    });

    document.addEventListener('mousemove', function (e) {
        if (!pointerLockActivo || modoArcangelActivo) return;

        yawCamara -= e.movementX * CAMARA_TERCERA_PERSONA.sensibilidadMouse;
        pitchCamara -= e.movementY * CAMARA_TERCERA_PERSONA.sensibilidadMouse;

        pitchCamara = THREE.MathUtils.clamp(
            pitchCamara,
            -CAMARA_TERCERA_PERSONA.limitePitch,
            CAMARA_TERCERA_PERSONA.limitePitch
        );
    });
}

function calcularDestinoCamaraTercerapersona() {
    if (!personaje) return null;

    const { distancia, altura, alturaMira } = CAMARA_TERCERA_PERSONA;

    const offsetX = Math.sin(yawCamara) * Math.cos(pitchCamara) * distancia;
    const offsetZ = Math.cos(yawCamara) * Math.cos(pitchCamara) * distancia;
    const offsetY = altura + Math.sin(pitchCamara) * distancia;

    return {
        posicion: new THREE.Vector3(
            personaje.position.x + offsetX,
            personaje.position.y + offsetY,
            personaje.position.z + offsetZ
        ),
        mira: new THREE.Vector3(
            personaje.position.x,
            personaje.position.y + alturaMira,
            personaje.position.z
        )
    };
}

function actualizarCamaraTercerapersona() {
    if (!personaje || modoArcangelActivo) return;

    const destino = calcularDestinoCamaraTercerapersona();
    if (!destino) return;

    camera.position.copy(destino.posicion);
    camera.lookAt(destino.mira);
}

/* =========================================================
   PANTALLA DE BIENVENIDA
   ========================================================= */

const CAMARA_VISTA_INICIO = {
    offsetX: -30,
    altura: 20,
    offsetZ: 50
};

function posicionarCamaraVistaInicio() {
    const base = POSICION_INICIAL_PERSONAJE;
    const alturaBase = calcularAlturaTerreno(base.x, base.z);

    camera.position.set(
        base.x + CAMARA_VISTA_INICIO.offsetX,
        alturaBase + CAMARA_VISTA_INICIO.altura,
        base.z + CAMARA_VISTA_INICIO.offsetZ
    );
    camera.lookAt(base.x, alturaBase + 2, base.z);
}

function mostrarPantallaInicio() {
    posicionarCamaraVistaInicio();

    const pantalla = document.getElementById('pantalla-inicio');
    if (pantalla) pantalla.classList.add('visible');
}

function iniciarExperiencia() {
    if (juegoIniciado) return;

    const pantalla = document.getElementById('pantalla-inicio');
    if (pantalla) pantalla.classList.add('oculto');

    const controlesAyuda = document.getElementById('controles-ayuda');
    if (controlesAyuda) controlesAyuda.classList.add('visible');

    juegoIniciado = true;
    transicionCamaraActiva = true;
    transicionCamaraProgreso = 0;
    transicionCamaraOrigen = camera.position.clone();

    actualizarInfoPorPosicion();
}

function init_pantalla_inicio() {
    const btnIniciar = document.getElementById('btn-iniciar');
    if (btnIniciar) btnIniciar.addEventListener('click', iniciarExperiencia);
}

function actualizarTransicionCamara(delta) {
    if (!transicionCamaraActiva) return;

    const destino = calcularDestinoCamaraTercerapersona();
    if (!destino || !transicionCamaraOrigen) {
        transicionCamaraActiva = false;
        return;
    }

    transicionCamaraProgreso += delta / DURACION_TRANSICION_CAMARA;
    const t = Math.min(transicionCamaraProgreso, 1);
    const tSuave = t * t * (3 - 2 * t);

    camera.position.lerpVectors(transicionCamaraOrigen, destino.posicion, tSuave);
    camera.lookAt(destino.mira);

    if (t >= 1) {
        transicionCamaraActiva = false;
    }
}

/* =========================================================
   INFO DE VISTAS / PANEL
   ========================================================= */

function cargarInfoVistas() {
    const datos = {};
    document.querySelectorAll('#datos-info .dato-vista').forEach(function (el) {
        const clave = el.dataset.vista;
        const parrafo = el.querySelector('p');
        datos[clave] = {
            etiqueta: el.dataset.etiqueta || '',
            titulo: el.dataset.titulo || '',
            texto: parrafo ? parrafo.textContent.trim() : '',
            fuente: el.dataset.fuente || '#',
            foto: el.dataset.foto || ''
        };
    });
    return datos;
}

const INFO_VISTAS = cargarInfoVistas();

function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(
        POSICION_INICIAL_PERSONAJE.x,
        6,
        POSICION_INICIAL_PERSONAJE.z + 8
    );

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.getElementById('contenedor3D').appendChild(renderer.domElement);

    setupIluminacion();
    aplicarModoIluminacion('dia');

    crearCielo();
    crearTerreno();

    cargarModelo("modelos3d/iglesia.glb", 0, 0, 0, 1, 1, 1, 0, true);
    cargarModelo("modelos3d/cura2.glb", -10, 3.3, 0, 5, 5, 5, Math.PI / -2, true);
    cargarModelo("modelos3d/arcangelop.glb", 0, 9, 0, 2, 2, 2, Math.PI / -2, false);
    cargarModelo("modelos3d/angl.glb", 0, 7, 3, 1.5, 1.5, 1.5, Math.PI / -2, false);
    cargarModelo("modelos3d/angl.glb", 0, 7, -3, 1.5, 1.5, 1.5, 0, false);

    cargarModelo("modelos3d/plaza_uncia.glb", -56.85, -4.3, -1.3, 2, 2, 2, 0, true);

    cargarPersonaje();

    POSICIONES_LAMPARAS.forEach(function (pos) {
        cargarModelo("modelos3d/lampara.glb", pos.x, pos.y, pos.z, 1, 1, 1, 0);
    });

    const luzLampara1 = push_spot_light(0xFFFFFF, 10, 50, 60, -28, 12.8, 0);
    const luzLampara2 = push_spot_light(0xFFFFFF, 10, 50, 60, -8, 12.8, 0);
    lucesLamparasSpot.push(luzLampara1, luzLampara2);
    actualizarLucesLamparas();

    init_pantalla_inicio();
    init_botones_modo();
    init_arcangel_giro();
    init_paneles_flotantes();
    init_controles_personaje();
    init_camara_tercera_persona();

    window.addEventListener('resize', onWindowResize);
}

function push_spot_light(color, intensity, distancia, angulo, px, py, pz) {
    const light = new THREE.SpotLight(
        color,
        intensity,
        distancia,
        THREE.MathUtils.degToRad(angulo),
        0.4,
        1
    );
    light.position.set(px, py, pz);
    light.castShadow = true;

    light.target.position.set(px, py - 10, pz);
    scene.add(light.target);
    scene.add(light);

    return light;
}

function actualizarLucesLamparas() {
    lucesLamparasSpot.forEach(function (luz) {
        luz.visible = modoOscuro;
    });
}

const ALTURA_BASE_TERRENO = -2.8;
const AMPLITUD_COLINAS = 6;
const ESCALA_RUIDO = 0.02;
const RADIO_ZONA_PLANA = 60;
const RADIO_TRANSICION = 120;

function ruido2D(x, y) {
    function hash(px, py) {
        const s = Math.sin(px * 127.1 + py * 311.7) * 43758.5453123;
        return s - Math.floor(s);
    }
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const suave = function (t) { return t * t * (3 - 2 * t); };

    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);

    const u = suave(xf);
    const v = suave(yf);

    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v);
}

function ruidoFractal(x, y, octavas) {
    let total = 0, amplitud = 1, frecuencia = 1, maxValor = 0;
    for (let i = 0; i < octavas; i++) {
        total += ruido2D(x * frecuencia, y * frecuencia) * amplitud;
        maxValor += amplitud;
        amplitud *= 0.5;
        frecuencia *= 2;
    }
    return total / maxValor;
}

function suavizarEntre(x, borde0, borde1) {
    if (x <= borde0) return 0;
    if (x >= borde1) return 1;
    const t = (x - borde0) / (borde1 - borde0);
    return t * t * (3 - 2 * t);
}

function calcularAlturaTerreno(x, z) {
    const distanciaCentro = Math.sqrt(x * x + z * z);
    const factorRelieve = suavizarEntre(distanciaCentro, RADIO_ZONA_PLANA, RADIO_TRANSICION);
    const ruido = ruidoFractal(x * ESCALA_RUIDO, z * ESCALA_RUIDO, 4);
    const desplazamiento = (ruido - 0.5) * 2 * AMPLITUD_COLINAS;
    return ALTURA_BASE_TERRENO + desplazamiento * factorRelieve;
}

function crearTerreno() {
    const tamano = 600;
    const segmentos = 200;

    const geometry = new THREE.PlaneGeometry(tamano, tamano, segmentos, segmentos);
    geometry.rotateX(-Math.PI / 2);

    const posiciones = geometry.attributes.position;
    for (let i = 0; i < posiciones.count; i++) {
        const x = posiciones.getX(i);
        const z = posiciones.getZ(i);
        posiciones.setY(i, calcularAlturaTerreno(x, z));
    }
    geometry.computeVertexNormals();

    const textureLoader = new THREE.TextureLoader();
    const texturaPasto = textureLoader.load('fotos/textura_pasto.jpg');
    texturaPasto.wrapS = THREE.RepeatWrapping;
    texturaPasto.wrapT = THREE.RepeatWrapping;
    texturaPasto.repeat.set(60, 60);

    const material = new THREE.MeshStandardMaterial({ map: texturaPasto });

    terrenoMesh = new THREE.Mesh(geometry, material);
    terrenoMesh.receiveShadow = true;
    scene.add(terrenoMesh);

    return terrenoMesh;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function cargarModelo(archivo, x, y, z, l, m, n, a, esTrofeo) {
    if (esTrofeo === undefined) esTrofeo = true;
    if (a === undefined) a = 0;

    const indice = totalModelos;
    totalModelos++;
    progresoModelos[indice] = { loaded: 0, total: 0 };

    const loader = new THREE.GLTFLoader();

    loader.load(
        archivo,
        function (gltf) {
            const modelo = gltf.scene;

            modelo.position.set(x, y, z);
            modelo.scale.set(l, m, n);
            modelo.rotation.y = a;

            modelo.traverse(function (child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;

                    corregirMaterialSolido(child.material);

                    if (child.material) {
                        if (child.material.map) {
                            child.material.map.encoding = THREE.sRGBEncoding;
                        }
                        if (child.material.emissiveMap) {
                            child.material.emissiveMap.encoding = THREE.sRGBEncoding;
                        }
                    }
                }
            });

            scene.add(modelo);

            if (esTrofeo) {
                modelo.updateMatrixWorld(true);

                // Doble cara solo en colisionables: si Blender exportó
                // alguna normal invertida, el raycast de colisión no la
                // atraviesa sin detectarla.
                modelo.traverse(function (child) {
                    if (child.isMesh && child.material) {
                        const materialesHijo = Array.isArray(child.material) ? child.material : [child.material];
                        materialesHijo.forEach(function (mat) {
                            mat.side = THREE.DoubleSide;
                        });
                    }
                });

                objetosColisionables.push(modelo);
            }

            progresoModelos[indice].loaded = progresoModelos[indice].total || 1;
            if (!progresoModelos[indice].total) progresoModelos[indice].total = 1;

            modelosCargados++;
            reportarProgreso();
        },
        function (xhr) {
            if (xhr.lengthComputable) {
                progresoModelos[indice].loaded = xhr.loaded;
                progresoModelos[indice].total = xhr.total;
                reportarProgreso();
            }
        },
        function (error) {
            console.error('Error cargando modelo:', archivo, error);
            progresoModelos[indice].loaded = progresoModelos[indice].total || 1;
            if (!progresoModelos[indice].total) progresoModelos[indice].total = 1;

            modelosCargados++;
            reportarProgreso();
        }
    );
}

function cargarModeloIndividual(archivo, x, y, z, l, m, n, a, callback) {
    const loader = new THREE.GLTFLoader();
    loader.load(
        archivo,
        function (gltf) {
            const modelo = gltf.scene;
            modelo.position.set(x, y, z);
            modelo.scale.set(l, m, n);
            modelo.rotation.y = a || 0;

            modelo.traverse(function (child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    corregirMaterialSolido(child.material);
                    if (child.material && child.material.map) {
                        child.material.map.encoding = THREE.sRGBEncoding;
                    }
                }
            });

            scene.add(modelo);
            if (callback) callback(modelo);
        },
        undefined,
        function (error) {
            console.error('Error cargando modelo:', archivo, error);
            if (callback) callback(null);
        }
    );
}

function reportarProgreso() {
    let loaded = 0;
    let total = 0;

    for (let i = 0; i < progresoModelos.length; i++) {
        loaded += progresoModelos[i].loaded;
        total += progresoModelos[i].total;
    }

    let porcentaje = total === 0 ? 0 : (loaded / total) * 100;

    const limite = (modelosCargados >= totalModelos) ? 100 : 99;
    porcentaje = Math.min(Math.round(porcentaje), limite);

    const barra = document.getElementById('barra-progreso');
    const texto = document.getElementById('texto-progreso');

    if (barra) barra.style.width = porcentaje + '%';
    if (texto) texto.textContent = porcentaje + '%';

    if (modelosCargados >= totalModelos && !escenaLista) {
        escenaLista = true;
        ocultarPantallaCarga();
    }
}

function ocultarPantallaCarga() {
    const overlay = document.getElementById('pantalla-carga');
    const contenedor = document.getElementById('contenedor3D');

    if (!overlay) return;

    setTimeout(function () {
        overlay.classList.add('oculto');
        if (contenedor) contenedor.classList.add('visible');

        mostrarPantallaInicio();

        overlay.addEventListener('transitionend', function () {
            overlay.remove();
        }, { once: true });
    }, 400);
}

const POSICION_INFO = {
    inicio: 'panel-derecha',
    interior: 'panel-izquierda',
    altar: 'panel-derecha',
    arcangel: 'panel-izquierda'
};

/* =========================================================
   CONTENIDO DEL PANEL SEGÚN LA POSICIÓN DEL PERSONAJE
   ========================================================= */

const ZONAS_INFO = [
    { clave: 'arcangel', xMin: -20, xMax: 0 },
    { clave: 'altar', xMin: -40, xMax: -20 },
    { clave: 'inicio', xMin: -50, xMax: -40 },
    { clave: 'interior', xMin: -70, xMax: -50 }
];
const Z_MINIMO_ZONAS = -10;
const Z_MAXIMO_ZONAS = 10;

function obtenerZonaPorPosicion(x, z) {
    if (z < Z_MINIMO_ZONAS || z > Z_MAXIMO_ZONAS) return null;

    for (let i = 0; i < ZONAS_INFO.length; i++) {
        const zona = ZONAS_INFO[i];
        if (x > zona.xMin && x <= zona.xMax) return zona.clave;
    }
    return null;
}

var zonaInfoActual = null;

function actualizarInfoPorPosicion() {
    if (!personaje || !juegoIniciado || modoArcangelActivo) return;

    const zona = obtenerZonaPorPosicion(personaje.position.x, personaje.position.z);
    if (zona === zonaInfoActual) return;
    zonaInfoActual = zona;

    if (zona) {
        mostrarInfo(zona);
    } else {
        ocultarInfo();
    }
}

function ocultarInfo() {
    const panel = document.getElementById('panel-info');
    if (panel) panel.classList.remove('visible');
}

function mostrarInfo(clave) {
    const datos = INFO_VISTAS[clave];
    if (!datos) return;

    const panel = document.getElementById('panel-info');
    const etiqueta = document.getElementById('panel-info-etiqueta');
    const titulo = document.getElementById('panel-info-titulo');
    const texto = document.getElementById('panel-info-texto');
    const fuente = document.getElementById('panel-info-fuente');
    const foto = document.getElementById('panel-info-foto');

    if (!panel) return;

    etiqueta.textContent = datos.etiqueta;
    titulo.textContent = datos.titulo;
    texto.textContent = datos.texto;
    fuente.href = datos.fuente;
    texto.appendChild(document.createTextNode(' '));
    texto.appendChild(fuente);

    if (foto) {
        if (datos.foto) {
            foto.src = datos.foto;
            foto.alt = datos.titulo;
            foto.hidden = false;
        } else {
            foto.hidden = true;
            foto.src = '';
        }
    }

    panel.classList.add('visible');
    panel.classList.remove('panel-derecha', 'panel-izquierda');
    panel.classList.add(POSICION_INFO[clave] || 'panel-derecha');

    const scroll = panel.querySelector('.panel-info-scroll');
    if (scroll) scroll.scrollTop = 0;
}

function init_paneles_flotantes() {
    const btnDesarrollador = document.getElementById('btn-desarrollador');
    const btnUbicacion = document.getElementById('btn-ubicacion');

    const panelDesarrollador = document.getElementById('panel-desarrollador');
    const panelUbicacion = document.getElementById('panel-ubicacion');
    if (!panelDesarrollador && !panelUbicacion) return;

    configurarCierrePaneles();

    if (btnDesarrollador) {
        btnDesarrollador.addEventListener('click', function () {
            ocultarPanel('panel-ubicacion');
            mostrarPanel('panel-desarrollador');
        });
    }

    if (btnUbicacion) {
        btnUbicacion.addEventListener('click', function () {
            ocultarPanel('panel-desarrollador');
            mostrarPanel('panel-ubicacion');
        });
    }
}

function mostrarPanel(id) {
    const panel = document.getElementById(id);
    if (panel) panel.classList.add('visible');
}

function ocultarPanel(id) {
    const panel = document.getElementById(id);
    if (panel) panel.classList.remove('visible');
}

function ocultarPanelesFlotantes() {
    ocultarPanel('panel-desarrollador');
    ocultarPanel('panel-ubicacion');
}

function configurarCierrePaneles() {
    ['panel-desarrollador', 'panel-ubicacion'].forEach(function (id) {
        const panel = document.getElementById(id);
        if (!panel) return;

        const btnCerrar = panel.querySelector('.btn-cerrar-desarrollador');
        const fondo = panel.querySelector('.panel-desarrollador-fondo');

        if (btnCerrar) btnCerrar.addEventListener('click', function () { ocultarPanel(id); });
        if (fondo) fondo.addEventListener('click', function () { ocultarPanel(id); });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') ocultarPanelesFlotantes();
    });
}

function init_arcangel_giro() {
    const el = renderer.domElement;
    let arrastrando = false;
    let ultimoX = 0;

    function empezar(x) {
        if (!arcangelInteractivo || !modeloArcangel || !modeloArcangel.visible) return;
        arrastrando = true;
        ultimoX = x;
        el.style.cursor = 'grabbing';
    }

    function mover(x) {
        if (!arrastrando || !modeloArcangel) return;
        const deltaX = x - ultimoX;
        ultimoX = x;
        modeloArcangel.rotation.y += deltaX * 0.012;
    }

    function terminar() {
        arrastrando = false;
        el.style.cursor = arcangelInteractivo ? 'grab' : '';
    }

    el.addEventListener('pointerdown', function (e) { empezar(e.clientX); });
    window.addEventListener('pointermove', function (e) { mover(e.clientX); });
    window.addEventListener('pointerup', terminar);
    window.addEventListener('pointercancel', terminar);
}

function mostrarArcangel() {
    if (!modeloArcangel) return;

    modeloArcangel.visible = true;
    modeloArcangel.rotation.y = VISTA_ARCANGEL.rotacionBase;
    posicionarArcangelFrenteCamara();
    mostrarInfo('arcangel');

    arcangelInteractivo = true;
    modoArcangelActivo = true;

    if (document.pointerLockElement) {
        document.exitPointerLock();
    }

    renderer.domElement.style.cursor = 'grab';
}

function ocultarArcangel() {
    if (modeloArcangel) {
        modeloArcangel.visible = false;
    }
    arcangelInteractivo = false;
    modoArcangelActivo = false;
    renderer.domElement.style.cursor = '';
}

function calcularDistanciaArcangel(modelo) {
    modelo.updateMatrixWorld(true);
    const caja = new THREE.Box3().setFromObject(modelo);
    const tamano = caja.getSize(new THREE.Vector3());
    const dimensionMayor = Math.max(tamano.x, tamano.y, tamano.z, 1);

    const fovVertical = THREE.MathUtils.degToRad(camera.fov);
    const distancia = (dimensionMayor / 2) / Math.tan(fovVertical / 2) / VISTA_ARCANGEL.fraccionPantalla;

    return distancia;
}

function calcularDesplazamientoLateralArcangel(distancia) {
    const fovVertical = THREE.MathUtils.degToRad(camera.fov);
    const alturaVisible = 2 * Math.tan(fovVertical / 2) * distancia;
    const anchoVisible = alturaVisible * camera.aspect;
    return anchoVisible * VISTA_ARCANGEL.fraccionLateral;
}

function posicionarArcangelFrenteCamara() {
    if (!modeloArcangel) return;

    const direccion = new THREE.Vector3();
    camera.getWorldDirection(direccion);

    const derechaCamara = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);

    const desplazamiento = calcularDesplazamientoLateralArcangel(VISTA_ARCANGEL.distanciaCamara);

    modeloArcangel.position
        .copy(camera.position)
        .addScaledVector(direccion, VISTA_ARCANGEL.distanciaCamara)
        .addScaledVector(derechaCamara, -desplazamiento);
    modeloArcangel.position.y += VISTA_ARCANGEL.ajusteVertical;
}

function crearCielo() {
    const sky = new THREE.Sky();

    const escalaCielo = camera.far * 0.9;
    sky.scale.setScalar(escalaCielo);
    scene.add(sky);

    const uniforms = sky.material.uniforms;
    uniforms['turbidity'].value = 1;
    uniforms['rayleigh'].value = 4;
    uniforms['mieCoefficient'].value = 0.001;
    uniforms['mieDirectionalG'].value = 0.85;

    sol = new THREE.Vector3();

    const elevacion = 25;
    const azimut = -160;

    const phi = THREE.MathUtils.degToRad(90 - elevacion);
    const theta = THREE.MathUtils.degToRad(azimut);

    sol.setFromSphericalCoords(1, phi, theta);
    uniforms['sunPosition'].value.copy(sol);

    crearSol(escalaCielo);
}

function crearTexturaResplandor(colorCentro, colorBorde) {
    const tam = 256;
    const canvas = document.createElement('canvas');
    canvas.width = tam;
    canvas.height = tam;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(tam / 2, tam / 2, 0, tam / 2, tam / 2, tam / 2);
    grad.addColorStop(0, colorCentro);
    grad.addColorStop(1, colorBorde);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tam, tam);

    return new THREE.CanvasTexture(canvas);
}

function crearSol(escalaCielo) {
    const textura = crearTexturaResplandor('rgba(255,250,225,1)', 'rgba(255,250,225,0)');
    const material = new THREE.SpriteMaterial({
        map: textura,
        transparent: true,
        depthWrite: false,
        depthTest: false
    });

    const distancia = escalaCielo * 0.4;
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(sol).multiplyScalar(distancia);

    const tamanoSol = distancia * 0.09;
    sprite.scale.set(tamanoSol, tamanoSol, 1);
    sprite.renderOrder = 0;

    scene.add(sprite);
    return sprite;
}

function setupIluminacion() {
    luzAmbiente = new THREE.HemisphereLight(0xdfe9f5, 0x3a2f1e, 0.1);
    scene.add(luzAmbiente);

    luzSol = new THREE.DirectionalLight(0xfff4e0, 2);
    luzSol.position.set(40, 60, 30);
    luzSol.castShadow = true;
    luzSol.shadow.mapSize.set(2048, 2048);
    luzSol.shadow.camera.left = -60;
    luzSol.shadow.camera.right = 60;
    luzSol.shadow.camera.top = 60;
    luzSol.shadow.camera.bottom = -60;
    luzSol.shadow.camera.near = 1;
    luzSol.shadow.camera.far = 200;
    luzSol.shadow.bias = -0.0015;
    scene.add(luzSol);

    luzRelleno = new THREE.DirectionalLight(0xbcd2ff, 0.5);
    luzRelleno.position.set(-30, 20, -30);
    scene.add(luzRelleno);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();
}

function aplicarModoIluminacion(modo) {
    const cfg = CONFIG_LUZ[modo];
    if (!cfg || !luzSol || !luzAmbiente || !luzRelleno) return;

    luzAmbiente.intensity = cfg.ambiente;

    luzSol.color.setHex(cfg.sol.color);
    luzSol.intensity = cfg.sol.intensidad;

    luzRelleno.color.setHex(cfg.relleno.color);
    luzRelleno.intensity = cfg.relleno.intensidad;

    renderer.toneMappingExposure = cfg.exposicion;
}

function activarModoDia() {
    if (!modoOscuro) return;
    modoOscuro = false;

    aplicarModoIluminacion('dia');
    actualizarLucesLamparas();
    actualizarBotonesModo();
}

function activarModoOscuro() {
    if (modoOscuro) return;
    modoOscuro = true;

    aplicarModoIluminacion('oscuro');
    actualizarLucesLamparas();
    actualizarBotonesModo();
}

function actualizarBotonesModo() {
    const btnDia = document.getElementById('btn-modo-dia');
    const btnNoche = document.getElementById('btn-modo-noche');

    if (btnDia) btnDia.classList.toggle('activo', !modoOscuro);
    if (btnNoche) btnNoche.classList.toggle('activo', modoOscuro);
}

function init_botones_modo() {
    const btnDia = document.getElementById('btn-modo-dia');
    const btnNoche = document.getElementById('btn-modo-noche');

    if (btnDia) btnDia.addEventListener('click', activarModoDia);
    if (btnNoche) btnNoche.addEventListener('click', activarModoOscuro);

    actualizarBotonesModo();
}

function animate() {
    requestAnimationFrame(animate);

    const delta = clockAnimaciones.getDelta();
    mixers.forEach(function (mixer) {
        mixer.update(delta);
    });

    actualizarPersonaje(delta);

    if (transicionCamaraActiva) {
        actualizarTransicionCamara(delta);
    } else if (juegoIniciado) {
        actualizarCamaraTercerapersona();
    }

    actualizarInfoPorPosicion();

    if (modeloArcangel && modeloArcangel.visible) {
        posicionarArcangelFrenteCamara();
        modeloArcangel.position.y += Math.sin(performance.now() * 0.0012) * 0.15;
    }

    renderer.render(scene, camera);
}

init();
animate();