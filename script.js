var scene, camera, renderer, controls;

// --- Control de carga inicial ---
var totalModelos = 0;
var modelosCargados = 0;
var progresoModelos = [];
var cajasColision = [];
var escenaLista = false;

// --- Control de vistas / cámara ---
var animandoCamara = false;
var RANGO_MOVIMIENTO = 4;   // rango permitido: 5° en horizontal/vertical, 5 unidades en zoom

// --- Modelo cargado bajo demanda ---
var arcangelCargado = false;
var modeloArcangel = null;
var arcangelInteractivo = false; // true mientras se puede arrastrar para girarlo

// --- Vista actual: evita que un botón mueva la cámara si ya está en ese lugar ---
var vistaActual = 'inicial';

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
    ajusteVertical: -0.5
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
            fuente: el.dataset.fuente || '#'
        };
    });
    return datos;
}

const INFO_VISTAS = cargarInfoVistas();

function init() {
    // Escena
    scene = new THREE.Scene();

    // Cámara
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(VISTA_INICIAL.pos.x, VISTA_INICIAL.pos.y, VISTA_INICIAL.pos.z);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    // --- Color management: esto hace que los colores se vean como en Blender ---
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // --- Sombras: sin esto, castShadow/receiveShadow en los modelos no hacen nada ---
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.getElementById('contenedor3D').appendChild(renderer.domElement);

    // Controles de órbita
    init_controls();

    // Luces + entorno de reflejos (aquí es donde el oro empieza a brillar de verdad)
    setupIluminacion();

    // Fondo de la escena
    cargarFondo("fotos/cielo.jpg");

    // --- Cargar modelos iniciales ---
    cargarModelo("modelos3d/iglesia_uncia.glb", 0, 0, 0, 1, 1, 1, 0, false);
    cargarModelo("modelos3d/cura2.glb", -10, 3.3, 0, 5, 5, 5, Math.PI / -2, false);
    cargarModelo("modelos3d/arcangelop.glb", 0, 9, 0, 2, 2, 2, Math.PI / -2, false);

    init_botones();

    init_arcangel_giro();

    init_panel_info();

    init_paneles_flotantes();

    // Reajustar tamaño al redimensionar la ventana
    window.addEventListener('resize', onWindowResize);
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

            // Al terminar, marcamos el progreso de ESTE modelo como completo
            progresoModelos[indice].loaded = progresoModelos[indice].total || 1;
            if (!progresoModelos[indice].total) progresoModelos[indice].total = 1;

            modelosCargados++;
            reportarProgreso();
        },
        function (xhr) {
            // Progreso real de descarga de ESTE modelo
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

// ==========================================================
// BARRA DE PROGRESO (real, basada en bytes descargados)
// ==========================================================
function reportarProgreso() {
    let loaded = 0;
    let total = 0;

    for (let i = 0; i < progresoModelos.length; i++) {
        loaded += progresoModelos[i].loaded;
        total += progresoModelos[i].total;
    }

    let porcentaje = total === 0 ? 0 : (loaded / total) * 100;

    // Nunca mostrar 100% hasta que TODOS los modelos hayan terminado de verdad
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

        // Nada más terminar de cargar, se muestra la información
        // general de la parroquia en el panel inferior.
        mostrarInfo('inicio');

        overlay.addEventListener('transitionend', function () {
            overlay.remove();
        }, { once: true });
    }, 400);
}

// ==========================================================
// PANEL INFERIOR DE INFORMACIÓN
// ==========================================================
function mostrarInfo(clave) {
    const datos = INFO_VISTAS[clave];
    if (!datos) return;

    const panel = document.getElementById('panel-info');
    const etiqueta = document.getElementById('panel-info-etiqueta');
    const titulo = document.getElementById('panel-info-titulo');
    const texto = document.getElementById('panel-info-texto');
    const fuente = document.getElementById('panel-info-fuente');

    if (!panel) return;

    etiqueta.textContent = datos.etiqueta;
    titulo.textContent = datos.titulo;
    texto.textContent = datos.texto;
    fuente.href = datos.fuente;

    panel.classList.add('visible');
    panel.classList.remove('colapsado'); // al cambiar de vista, se vuelve a abrir

    // Si el panel tiene scroll de una vista anterior, lo regresamos arriba
    const scroll = panel.querySelector('.panel-info-scroll');
    if (scroll) scroll.scrollTop = 0;
}

function init_panel_info() {
    const toggle = document.getElementById('panel-info-toggle');
    const panel = document.getElementById('panel-info');
    if (toggle && panel) {
        toggle.addEventListener('click', function () {
            panel.classList.toggle('colapsado');
        });
    }
}

// ==========================================================
// PANELES "DESARROLLADO POR" Y "UBICACIÓN"
// ==========================================================
// El contenido de ambos paneles (foto, nombre, redes, mapa, etc.)
// vive en desarrollador.html. Aquí solo se descarga con fetch() una
// vez -ya que un solo archivo trae los dos paneles- y se inyecta
// dentro de #contenedor-desarrollador, para que aparezcan como
// paneles flotantes sobre la escena 3D sin salir nunca de esta página.
var panelesCargados = false;

function init_paneles_flotantes() {
    const btnDesarrollador = document.getElementById('btn-desarrollador');
    const btnUbicacion = document.getElementById('btn-ubicacion');

    // Los dos paneles ya están incluidos en index.html. La versión anterior
    // esperaba un elemento #contenedor-desarrollador que ya no existe y salía
    // aquí antes de registrar los eventos de ambos botones.
    const panelDesarrollador = document.getElementById('panel-desarrollador');
    const panelUbicacion = document.getElementById('panel-ubicacion');
    if (!panelDesarrollador && !panelUbicacion) return;

    panelesCargados = true;
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

// Se llama una sola vez, justo después de inyectar desarrollador.html,
// para conectar -en CADA panel presente- el botón de cerrar y el
// clic fuera de la tarjeta, además de la tecla Escape para los dos.
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

// ==========================================================
// CONTROLES DE CÁMARA
// ==========================================================
function init_controls() {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(VISTA_INICIAL.target.x, VISTA_INICIAL.target.y, VISTA_INICIAL.target.z);

    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.enablePan = false;
    controls.autoRotate = false; // desactivado: con un rango de solo 5° no se ve bien la autorotación

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
        // Sensibilidad del giro: ajusta este número si lo quieres más rápido/lento.
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

function actualizarLimitesControles() {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const esferico = new THREE.Spherical().setFromVector3(offset);
    const rangoRad = THREE.MathUtils.degToRad(RANGO_MOVIMIENTO);

    controls.minAzimuthAngle = esferico.theta - rangoRad;
    controls.maxAzimuthAngle = esferico.theta + rangoRad;

    controls.minPolarAngle = Math.max(0.01, esferico.phi - rangoRad);
    controls.maxPolarAngle = Math.min(Math.PI - 0.01, esferico.phi + rangoRad);

    controls.minDistance = Math.max(0.1, esferico.radius - RANGO_MOVIMIENTO);
    controls.maxDistance = esferico.radius + RANGO_MOVIMIENTO;

    controls.update();
}

// Cambia hacia dónde apunta la cámara sin moverla de lugar
function apuntarCamara(x, y, z) {
    controls.target.set(x, y, z);
    controls.update();
    actualizarLimitesControles();
}

// Mueve la cámara suavemente a una nueva posición y target
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
        const suave = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOutQuad

        camera.position.lerpVectors(posInicio, posDestino, suave);
        controls.target.lerpVectors(targetInicio, targetDestino, suave);
        controls.update();

        if (t < 1) {
            requestAnimationFrame(paso);
        } else {
            animandoCamara = false;
            controls.enabled = true;
            // Recién ahora, con la cámara ya en el destino final, aplicamos el rango ±5
            actualizarLimitesControles();
        }
    }

    requestAnimationFrame(paso);
}

// ==========================================================
// BOTONES DE NAVEGACIÓN
// ==========================================================
function init_botones() {
    const btnInicio = document.getElementById('btn-inicio');
    const btnInterior = document.getElementById('btn-interior');
    const btnAltar = document.getElementById('btn-altar');
    const btnArcangel = document.getElementById('btn-arcangel');

    if (btnInicio) {
        btnInicio.addEventListener('click', function () {
            ocultarArcangel(); // al cambiar de vista, el modelo del arcángel desaparece

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
            ocultarArcangel(); // al cambiar de vista, el modelo del arcángel desaparece

            mostrarInfo('interior'); // el texto se actualiza aunque ya estemos en esta vista

            if (vistaActual === 'interior') return; // ya está en esta vista, no se mueve la cámara

            vistaActual = 'interior';
            moverCamara(
                new THREE.Vector3(VISTA_INTERIOR.pos.x, VISTA_INTERIOR.pos.y, VISTA_INTERIOR.pos.z),
                new THREE.Vector3(VISTA_INTERIOR.target.x, VISTA_INTERIOR.target.y, VISTA_INTERIOR.target.z)
            );
        });
    }

    if (btnAltar) {
        btnAltar.addEventListener('click', function () {
            ocultarArcangel(); // al cambiar de vista, el modelo del arcángel desaparece

            mostrarInfo('altar'); // el texto se actualiza aunque ya estemos en esta vista

            if (vistaActual === 'altar') return; // ya está en esta vista, no se mueve la cámara

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
                0, 0, 0, // posición inicial neutra: se recalcula frente a la cámara cada cuadro
                1, 1, 1, VISTA_ARCANGEL.rotacionBase,
                function (modelo) {
                    btnArcangel.disabled = false;
                    btnArcangel.textContent = textoOriginal;

                    if (modelo) {
                        modeloArcangel = modelo;
                        arcangelCargado = true;
                        // Con el modelo ya cargado se conoce su tamaño real:
                        // calculamos la distancia que hace que ocupe casi
                        // toda la pantalla, una sola vez.
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

// Muestra el modelo del Arcángel: lo hace visible, lo ubica frente a
// la cámara y desactiva la órbita de la cámara principal para dejar
// el arrastre libre exclusivamente para girar el modelo.
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

// Oculta el modelo del Arcángel (si ya fue cargado) sin eliminarlo de
// la escena, para que reaparecer con el botón sea instantáneo, y
// devuelve el control de la cámara a la órbita normal.
function ocultarArcangel() {
    if (modeloArcangel) {
        modeloArcangel.visible = false;
    }
    arcangelInteractivo = false;
    controls.enabled = true;
    renderer.domElement.style.cursor = '';
}

// Calcula la distancia a la que hay que ubicar el modelo frente a la
// cámara para que ocupe VISTA_ARCANGEL.fraccionPantalla de la altura
// de pantalla, según el tamaño REAL del modelo cargado (no un número
// fijo a ojo, que se ve distinto según el archivo .glb que se use).
function calcularDistanciaArcangel(modelo) {
    modelo.updateMatrixWorld(true);
    const caja = new THREE.Box3().setFromObject(modelo);
    const tamano = caja.getSize(new THREE.Vector3());
    const dimensionMayor = Math.max(tamano.x, tamano.y, tamano.z, 1);

    const fovVertical = THREE.MathUtils.degToRad(camera.fov);
    const distancia = (dimensionMayor / 2) / Math.tan(fovVertical / 2) / VISTA_ARCANGEL.fraccionPantalla;

    return distancia;
}

// Coloca el modelo del Arcángel siempre frente a la cámara, a la
// distancia definida en VISTA_ARCANGEL.distanciaCamara, para que se
// vea centrado en pantalla sin importar hacia dónde esté mirando la
// cámara en ese momento (no depende de una posición fija del mundo).
function posicionarArcangelFrenteCamara() {
    if (!modeloArcangel) return;

    const direccion = new THREE.Vector3();
    camera.getWorldDirection(direccion);


    modeloArcangel.position
        .copy(camera.position)
        .addScaledVector(direccion, VISTA_ARCANGEL.distanciaCamara);
    modeloArcangel.position.y += VISTA_ARCANGEL.ajusteVertical;
}

// ==========================================================
// FONDO Y LUZ
// ==========================================================
function cargarFondo(archivo) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
        archivo,
        function (texture) {
            texture.encoding = THREE.sRGBEncoding;
            scene.background = texture;
        },
        undefined,
        function (error) {
            console.error('Error cargando el fondo:', error);
        }
    );
}

function setupIluminacion() {
    // Luz ambiental que llena las sombras con un tono frío arriba
    // y cálido abajo (simula luz de cielo + rebote del suelo).
    const ambiente = new THREE.HemisphereLight(0xdfe9f5, 0x3a2f1e, 1.1);
    scene.add(ambiente);

    // Luz principal ("sol"): la única que proyecta sombras.
    const sol = new THREE.DirectionalLight(0xfff4e0, 2.4);
    sol.position.set(40, 60, 30);
    sol.castShadow = true;
    sol.shadow.mapSize.set(2048, 2048);
    sol.shadow.camera.left = -60;
    sol.shadow.camera.right = 60;
    sol.shadow.camera.top = 60;
    sol.shadow.camera.bottom = -60;
    sol.shadow.camera.near = 1;
    sol.shadow.camera.far = 200;
    sol.shadow.bias = -0.0015;
    scene.add(sol);

    // Luz de relleno, suave y sin sombra, para no dejar el lado
    // opuesto al sol completamente negro.
    const relleno = new THREE.DirectionalLight(0xbcd2ff, 0.5);
    relleno.position.set(-30, 20, -30);
    scene.add(relleno);

    // Entorno PMREM: le da a los materiales metálicos (dorados,
    // pátinas, vidrio) algo que reflejar. Sin esto, un material
    // "gold" con metalness alto se ve gris apagado en vez de brillar.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();
}

// ==========================================================
// LOOP PRINCIPAL
// ==========================================================
function animate() {
    requestAnimationFrame(animate);
    if (modeloArcangel && modeloArcangel.visible) {
        posicionarArcangelFrenteCamara();
        modeloArcangel.position.y += Math.sin(performance.now() * 0.0012) * 0.15;
    }

    controls.update();
    renderer.render(scene, camera);
}

init();
animate();