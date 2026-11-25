const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const rq = require('@tanstack/react-query');
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: name => { assert.ok(name in deps, name); return deps[name]; } });
  return exports;
}
const menciones = load('src/lib/menciones.ts');
const personas = [{ id: 'identificador_completo_1', nombre: 'Ana' }, { id: 'identificador_completo_2', nombre: 'Ana' }];
const page = (n, datos, totalPaginas = 1) => ({ datos, meta: { pagina: n, totalPaginas, tamanoPagina: 20, total: datos.length } });
function options(api) {
  return load('src/lib/miembrosMencionables.ts', { '@tanstack/react-query': rq,
    '../api/comentarios': { listarMiembrosMencionables: api },
    './comentariosLectura': { accesoComentariosDenegado: e => [401, 403, 404].includes(e.statusCode) } });
}
function harness(publicacion) {
  let states = [], index = 0, query = { isPending: false, isFetching: false, isError: false,
    data: { pages: [page(1, personas)] } }, focused = 0;
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const mod = load('src/components/ComentarioBorrador.tsx', {
    react: { useState: initial => { const i = index++, storage = states; if (!(i in storage)) storage[i] = initial;
      return [storage[i], next => { storage[i] = typeof next === 'function' ? next(storage[i]) : next; }]; },
    useRef: () => ({ current: { focus: () => focused++ } }) },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(n => [n, n])), Platform: { OS: 'android' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@tanstack/react-query': { useInfiniteQuery: () => query },
    '../lib/menciones': menciones, '../lib/miembrosMencionables': { miembrosMencionablesOptions: () => ({}) },
    '../lib/comentariosLectura': { accesoComentariosDenegado: () => false },
    '../theme/colors': { colors: { primary: '#245B4A', text: '#34413A', background: '#F7F8F5' } },
  });
  let selectorState = [];
  function render(selector = false) {
    index = 0;
    let tree = mod.ComentarioBorrador({ tareaId: 't', perderAcceso() {}, publicacion });
    if (selector) {
      const element = tree.props.children.find(n => typeof n?.type === 'function');
      assert.ok(element);
      const editorStates = states; states = selectorState; index = 0;
      tree = element.type(element.props); selectorState = states; states = editorStates;
    }
    const nodes = [];
    function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (n == null || typeof n === 'boolean') return;
      nodes.push(n); if (typeof n === 'object') walk(n.props.children); }
    walk(tree);
    return { nodes, text: nodes.filter(n => typeof n === 'string').join('\n'),
      input: nodes.find(n => n?.type === 'TextInput'), buttons: nodes.filter(n => n?.type === 'Pressable') };
  }
  return { render, setQuery: q => { query = { ...query, ...q }; }, focusCount: () => focused };
}
test('editor: inserta en selección UTF16, conserva extremos Unicode y homónimos por ID completo', () => {
  const h = harness(); let ui = h.render();
  ui.input.props.onChangeText('😀 inicio reemplazar fin 🐱');
  ui.input.props.onSelectionChange({ nativeEvent: { selection: { start: 10, end: 20 } } });
  ui = h.render(); ui.buttons[0].props.onPress();
  const selector = h.render(true);
  assert.equal(selector.buttons.filter(b => b.props.accessibilityLabel?.startsWith('Mencionar a Ana')).length, 2);
  selector.buttons[1].props.onPress();
  ui = h.render();
  assert.equal(ui.input.props.value, '😀 inicio @[identificador_completo_2] fin 🐱');
  assert.equal(ui.input.props.selection.start, '😀 inicio @[identificador_completo_2]'.length);
  assert.ok(ui.text.includes('@Ana'));
  assert.ok(ui.nodes.some(n => n?.props?.accessibilityLabel === 'mención a Ana'));
  assert.equal(h.focusCount(), 1);
});
test('editor: edición libre, límites Unicode y sintaxis sin truncamiento UTF16', () => {
  const h = harness(); let ui = h.render();
  assert.equal(ui.input.props.maxLength, undefined);
  for (const [texto, error] of [['😀'.repeat(4000), null], ['😀'.repeat(4001), '4000 caracteres'],
    [Array.from({ length: 21 }, (_, i) => `@[u${i}]`).join(''), '20 personas'], ['@[roto', 'Mención inválida']]) {
    ui.input.props.onChangeText(texto); ui = h.render();
    assert.equal(ui.input.props.value, texto);
    if (error) assert.ok(ui.text.includes(error)); else assert.ok(!ui.text.includes('⚠'));
  }
  ui.input.props.onChangeText('texto editado @Ana @@[literal]'); ui = h.render();
  assert.equal(ui.input.props.value, 'texto editado @Ana @@[literal]');
  assert.ok(ui.text.includes('texto editado @Ana @[literal]'));
});
test('editor: no hay publicación, persistencia, coordinador ni guardado de tarea', () => {
  const src = fs.readFileSync('src/components/ComentarioBorrador.tsx', 'utf8');
  assert.doesNotMatch(src, /crearComentario|WriteCoordinator|method:|\bfetch\(|AsyncStorage|SecureStore|onSubmitEditing/);
  const h = harness(); assert.deepEqual(h.render().buttons.map(b => b.props.children.props.children), ['@ Mencionar']);
  assert.equal(harness().render().input.props.value, '');
});
test('editor: inserción en cursor consume @, repetidas cuentan una vez y IDs desconocidos siguen canónicos', () => {
  const h = harness(); let ui = h.render();
  ui.input.props.onChangeText('😀 @ final');
  ui.input.props.onSelectionChange({ nativeEvent: { selection: { start: 4, end: 4 } } });
  h.render().buttons[0].props.onPress(); h.render(true).buttons[0].props.onPress();
  ui = h.render();
  assert.equal(ui.input.props.value, '😀 @[identificador_completo_1] final');
  const texto = '@[identificador_completo_1] @[identificador_completo_1] @[desconocido]';
  ui.input.props.onChangeText(texto); ui = h.render();
  assert.equal(ui.input.props.value, texto);
  assert.equal(ui.nodes.filter(n => n?.props?.accessibilityLabel === 'mención a Ana').length, 2);
  assert.ok(ui.text.includes('@[desconocido]'));
  assert.equal(menciones.analizarTexto(texto).ids.length, 2);
});
test('selector: carga, vacío, error y búsqueda larga no filtran datos previos; cerrar conserva borrador', () => {
  const h = harness(); let ui = h.render(); ui.input.props.onChangeText('conservar');
  h.render().buttons[0].props.onPress();
  for (const [state, message] of [[{ isPending: true }, 'Cargando miembros…'],
    [{ isPending: false, isError: true }, 'No se pudieron cargar los miembros'],
    [{ isError: false, data: { pages: [page(1, [])] } }, 'No hay miembros disponibles para mencionar']]) {
    h.setQuery(state); const selector = h.render(true); assert.ok(selector.text.includes(message));
    assert.ok(!selector.text.includes('identificador_completo_1'));
  }
  let selector = h.render(true); selector.input.props.onChangeText('Ana');
  assert.ok(h.render(true).text.includes('No encontramos miembros'));
  selector.input.props.onChangeText('a'.repeat(81));
  assert.ok(h.render(true).text.includes('La búsqueda no puede superar 80 caracteres.'));
  selector = h.render(true); selector.buttons.at(-1).props.onPress();
  assert.equal(h.render().input.props.value, 'conservar');
});
test('query real: búsqueda normalizada, páginas y respuestas obsoletas aisladas', async () => {
  let resolveOld; const calls = [];
  const lib = options(async (id, params) => {
    calls.push([id, params.q, params.page, params.pageSize]);
    if (params.q === 'vieja') return new Promise(resolve => { resolveOld = resolve; });
    return page(params.page, personas, 2);
  });
  const client = new rq.QueryClient();
  const observer = new rq.InfiniteQueryObserver(client, lib.miembrosMencionablesOptions('t', 'vieja', () => {}));
  const old = observer.refetch();
  observer.setOptions(lib.miembrosMencionablesOptions('t', ' nueva ', () => {}));
  await observer.refetch(); await observer.fetchNextPage();
  resolveOld(page(1, [{ id: 'old', nombre: 'Obsoleto' }])); await old;
  assert.equal(observer.getCurrentResult().data.pages[0].datos[0].id, personas[0].id);
  assert.deepEqual(calls, [['t', 'vieja', 1, 20], ['t', 'nueva', 1, 20], ['t', 'nueva', 2, 20]]);
  client.clear();
});
test('query real: acceso perdido notifica una vez, sin retry ni caché durable', async () => {
  for (const statusCode of [401, 403, 404]) {
    let denied = 0, calls = 0;
    const lib = options(async () => { calls++; throw { statusCode }; });
    const opts = lib.miembrosMencionablesOptions('t', '', () => denied++);
    const client = new rq.QueryClient(); await assert.rejects(client.fetchInfiniteQuery(opts));
    assert.equal(denied, 1); assert.equal(calls, 1); assert.equal(opts.gcTime, 0);
    assert.equal(opts.refetchOnMount, 'always'); client.clear();
  }
});
test('selector: reintento independiente y paginación con bloqueo durante solicitud', () => {
  const h = harness(); h.render().buttons[0].props.onPress();
  const actions = [];
  h.setQuery({ isError: true, refetch: () => actions.push('refetch') });
  h.render(true).buttons[0].props.onPress();
  h.setQuery({ isFetchNextPageError: true, fetchNextPage: () => actions.push('next') });
  h.render(true).buttons[0].props.onPress();
  h.setQuery({ isError: false, hasNextPage: true });
  let selector = h.render(true); selector.buttons.at(-2).props.onPress();
  h.setQuery({ isFetching: true, isFetchingNextPage: true });
  selector = h.render(true);
  assert.equal(selector.buttons.at(-2).props.disabled, true);
  selector.buttons.at(-2).props.onPress();
  assert.deepEqual(actions, ['refetch', 'next', 'next']);
});
test('editor 3C: Publicar envía canónico exacto; guarda síncrona bloquea edición/selector incluso antes de render', () => {
  let editable = true; const calls = [];
  const publicacion = { bloqueado: false, puedeEditar: () => editable,
    publicar: text => { calls.push(text); editable = false; } };
  const h = harness(publicacion); let ui = h.render();
  ui.input.props.onChangeText(' Hola @[usr_2] '); ui = h.render();
  const publish = ui.buttons.find(b => b.props.accessibilityLabel === 'Publicar comentario');
  assert.equal(publish.props.disabled, false); publish.props.onPress();
  ui.input.props.onChangeText('no debe mutar'); ui.buttons[0].props.onPress();
  assert.equal(h.render().input.props.value, ' Hola @[usr_2] ');
  assert.deepEqual(calls, [' Hola @[usr_2] ']);
  publicacion.bloqueado = true; ui = h.render();
  assert.equal(ui.input.props.editable, false); assert.equal(ui.buttons[0].props.disabled, true);
  assert.equal(ui.buttons[1].props.disabled, true);
});
