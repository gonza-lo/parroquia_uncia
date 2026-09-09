var scene, camera, renderer, controls;

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
var cajasColision = [];
var escenaLista = false;

var animandoCamara = false;
var RANGO_MOVIMIENTO_HORIZONTAL = 20;
var RANGO_MOVIMIENTO_VERTICAL = 4;

var arcangelCargado = false;
var modeloArcangel = null;
var arcangelInteractivo = false;

var vistaActual = 'inicial';

var luzAmbiente, luzSol, luzRelleno;
var modoOscuro = false;

var sol;

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

const VISTA_INICIAL = {
    pos: { x: -75, y: 20, z: 10 },
    target: { x: 0, y: 0, z: 0 }
};

const VISTA_INTERIOR = {
    pos: { x: -35, y: 7, z: 0 },
    target: { x: 0, y: 0, z: 0 }
};

const VISTA_ALTAR = {
    pos: { x: -20, y: 10, z: 0 },
    target: { x: 0, y: 0, z: 0 }
};

const VISTA_ARCANGEL = {
    distanciaCamara: 14,
    fraccionPantalla: 0.82,
    rotacionBase: Math.PI / -2,
    ajusteVertical: -0.5,
    fraccionLateral: 0
};

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
    camera.position.set(VISTA_INICIAL.pos.x, VISTA_INICIAL.pos.y, VISTA_INICIAL.pos.z);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.getElementById('contenedor3D').appendChild(renderer.domElement);

    init_controls();

    setupIluminacion();
    aplicarModoIluminacion('dia');

    crearCielo();
    crearTerreno();

    cargarModelo("modelos3d/iglesia.glb", 0, 0, 0, 1, 1, 1, 0, false);
    cargarModelo("modelos3d/cura2.glb", -10, 3.3, 0, 5, 5, 5, Math.PI / -2, false);
    cargarModelo("modelos3d/arcangelop.glb", 0, 9, 0, 2, 2, 2, Math.PI / -2, false);
    cargarModelo("modelos3d/angl.glb", 0, 7, 3, 1.5, 1.5, 1.5, Math.PI / -2, false);
    cargarModelo("modelos3d/angl.glb", 0, 7, -3, 1.5, 1.5, 1.5, Math.PI / 2, false);

    cargarModelo("modelos3d/arbol.glb", -70, 1, -10, 2, 2, 2, 0, false);

    cargarModeloFBX('modelos3d/militar.fbx', -40, 3.3, -12, 0.2, 0.2, 0.2);

    POSICIONES_LAMPARAS.forEach(function (pos) {
        cargarModelo("modelos3d/lampara_araña.glb", pos.x, pos.y, pos.z, 1, 1, 1, 0);
    });

    const luzLampara1 = push_spot_light(0xFFFFFF, 10, 50, 60, -28, 12.8, 0);
    const luzLampara2 = push_spot_light(0xFFFFFF, 10, 50, 60, -8, 12.8, 0);
    lucesLamparasSpot.push(luzLampara1, luzLampara2);
    actualizarLucesLamparas();

    init_botones();
    init_botones_modo();
    init_arcangel_giro();
    init_paneles_flotantes();

    window.addEventListener('resize', onWindowResize);
}

// Carga un FBX y reproduce su animación si trae alguna
function cargarModeloFBX(archivo, x, y, z, l, m, n) {
    x = (x !== undefined) ? x : 0;
    y = (y !== undefined) ? y : 0;
    z = (z !== undefined) ? z : 0;
    l = (l !== undefined) ? l : 1;
    m = (m !== undefined) ? m : 1;
    n = (n !== undefined) ? n : 1;

    const loader = new THREE.FBXLoader();
    loader.load(
        archivo,
        function (modelo) {
            modelo.scale.set(l, m, n);
            modelo.position.set(x, y, z);

            modelo.traverse(function (child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }

                if (child.isLight) {
                    child.intensity *= 0;
                }
            });

            if (modelo.animations && modelo.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(modelo);
                const accion = mixer.clipAction(modelo.animations[0]);
                accion.play();
                mixers.push(mixer);
            }

            scene.add(modelo);
            console.log('Modelo FBX cargado correctamente:', archivo);
        },
        undefined,
        function (error) {
            console.error('❌ Error al cargar el FBX:', error);
        }
    );
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
const RADIO_ZONA_PLANA = 30;
const RADIO_TRANSICION = 60;

// Ruido tipo "value noise" hecho a mano, sin librerías externas
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

// Combina varias capas de ruido para un relieve más natural
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

// Altura del terreno en (x, z); la usan tanto el suelo como los árboles
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

    const terrenoMesh = new THREE.Mesh(geometry, material);
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
                const caja = new THREE.Box3().setFromObject(modelo);
                if (isFinite(caja.min.x) && isFinite(caja.max.x)) {
                    cajasColision.push(caja);
                }
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
    const panelBotones = document.getElementById('panel-botones');

    if (!overlay) return;

    setTimeout(function () {
        overlay.classList.add('oculto');
        if (contenedor) contenedor.classList.add('visible');
        if (panelBotones) panelBotones.classList.add('visible');

        mostrarInfo('inicio');

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

function init_controls() {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(VISTA_INICIAL.target.x, VISTA_INICIAL.target.y, VISTA_INICIAL.target.z);

    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.autoRotate = false;

    controls.update();
    actualizarLimitesControles();
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

// Limita cuánto puede orbitar y hacer zoom la cámara; en la vista de inicio usa el
// rango horizontal amplio, en el resto de vistas usa el rango vertical en todas direcciones
function actualizarLimitesControles() {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const esferico = new THREE.Spherical().setFromVector3(offset);

    const rangoActivo = (vistaActual === 'inicial') ? RANGO_MOVIMIENTO_HORIZONTAL : RANGO_MOVIMIENTO_VERTICAL;
    const rangoHorizontal = THREE.MathUtils.degToRad(rangoActivo);
    const rangoVertical = THREE.MathUtils.degToRad(RANGO_MOVIMIENTO_VERTICAL);

    controls.minAzimuthAngle = esferico.theta - rangoHorizontal;
    controls.maxAzimuthAngle = esferico.theta + rangoHorizontal;

    controls.minPolarAngle = Math.max(0.01, esferico.phi - rangoVertical);
    controls.maxPolarAngle = Math.min(Math.PI - 0.01, esferico.phi + rangoVertical);

    controls.minDistance = Math.max(0.1, esferico.radius - rangoActivo);
    controls.maxDistance = esferico.radius + rangoActivo;

    controls.update();
}

function apuntarCamara(x, y, z) {
    controls.target.set(x, y, z);
    controls.update();
    actualizarLimitesControles();
}

function moverCamara(posDestino, targetDestino, duracion) {
    if (duracion === undefined) duracion = 1200;
    if (animandoCamara) return;

    animandoCamara = true;
    controls.enabled = false;

    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.minDistance = 0;
    controls.maxDistance = Infinity;

    const posInicio = camera.position.clone();
    const targetInicio = controls.target.clone();
    const tiempoInicio = performance.now();

    function paso(ahora) {
        const t = Math.min((ahora - tiempoInicio) / duracion, 1);
        const suave = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

        camera.position.lerpVectors(posInicio, posDestino, suave);
        controls.target.lerpVectors(targetInicio, targetDestino, suave);
        controls.update();

        if (t < 1) {
            requestAnimationFrame(paso);
        } else {
            animandoCamara = false;
            controls.enabled = true;
            actualizarLimitesControles();
        }
    }

    requestAnimationFrame(paso);
}

function init_botones() {
    const btnInicio = document.getElementById('btn-inicio');
    const btnInterior = document.getElementById('btn-interior');
    const btnAltar = document.getElementById('btn-altar');
    const btnArcangel = document.getElementById('btn-arcangel');

    if (btnInicio) {
        btnInicio.addEventListener('click', function () {
            ocultarArcangel();

            if (vistaActual === 'inicial') return;

            vistaActual = 'inicial';
            moverCamara(
                new THREE.Vector3(VISTA_INICIAL.pos.x, VISTA_INICIAL.pos.y, VISTA_INICIAL.pos.z),
                new THREE.Vector3(VISTA_INICIAL.target.x, VISTA_INICIAL.target.y, VISTA_INICIAL.target.z)
            );
            mostrarInfo('inicio');
        });
    }

    if (btnInterior) {
        btnInterior.addEventListener('click', function () {
            ocultarArcangel();

            mostrarInfo('interior');

            if (vistaActual === 'interior') return;

            vistaActual = 'interior';
            moverCamara(
                new THREE.Vector3(VISTA_INTERIOR.pos.x, VISTA_INTERIOR.pos.y, VISTA_INTERIOR.pos.z),
                new THREE.Vector3(VISTA_INTERIOR.target.x, VISTA_INTERIOR.target.y, VISTA_INTERIOR.target.z)
            );
        });
    }

    if (btnAltar) {
        btnAltar.addEventListener('click', function () {
            ocultarArcangel();

            mostrarInfo('altar');

            if (vistaActual === 'altar') return;
            vistaActual = 'altar';
            moverCamara(
                new THREE.Vector3(VISTA_ALTAR.pos.x, VISTA_ALTAR.pos.y, VISTA_ALTAR.pos.z),
                new THREE.Vector3(VISTA_ALTAR.target.x, VISTA_ALTAR.target.y, VISTA_ALTAR.target.z)
            );
        });
    }
    if (btnArcangel) {
        btnArcangel.addEventListener('click', function () {
            if (arcangelCargado) {
                mostrarArcangel();
                return;
            }

            btnArcangel.disabled = true;
            const textoOriginal = btnArcangel.textContent;
            btnArcangel.textContent = 'Cargando...';

            cargarModeloIndividual(
                "modelos3d/arcangelop.glb",
                0, 0, 0,
                1, 1, 1, VISTA_ARCANGEL.rotacionBase,
                function (modelo) {
                    btnArcangel.disabled = false;
                    btnArcangel.textContent = textoOriginal;

                    if (modelo) {
                        modeloArcangel = modelo;
                        arcangelCargado = true;

                        VISTA_ARCANGEL.distanciaCamara = calcularDistanciaArcangel(modelo);
                        mostrarArcangel();
                    } else {
                        console.error('No se pudo cargar el modelo del arcángel.');
                    }
                }
            );
        });
    }
}

function mostrarArcangel() {
    if (!modeloArcangel) return;

    modeloArcangel.visible = true;
    modeloArcangel.rotation.y = VISTA_ARCANGEL.rotacionBase;
    posicionarArcangelFrenteCamara();
    mostrarInfo('arcangel');

    controls.enabled = false;
    arcangelInteractivo = true;
    renderer.domElement.style.cursor = 'grab';
}

function ocultarArcangel() {
    if (modeloArcangel) {
        modeloArcangel.visible = false;
    }
    arcangelInteractivo = false;
    controls.enabled = true;
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

// Mantiene el arcángel siempre frente a la cámara
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

// Cielo procedural con THREE.Sky
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

    if (modeloArcangel && modeloArcangel.visible) {
        posicionarArcangelFrenteCamara();
        modeloArcangel.position.y += Math.sin(performance.now() * 0.0012) * 0.15;
    }

    controls.update();
    renderer.render(scene, camera);
}

init();
animate();