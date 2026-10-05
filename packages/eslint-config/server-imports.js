/**
 * Keeps `.server` modules out of the browser. TanStack Start's import protection denies
 * `**\/*.server.*` files in the client bundle and, in dev, swaps them for a mock, so a page that
 * reads a runtime value from one crashes in the browser while its unit tests pass (#521, #538).
 *
 * A value imported from a `.server` module may only be used where the Start compiler strips the
 * code from the client: a server function's `.handler()` and `.validator()`, `createServerOnlyFn()`,
 * the `.server()` and `.validator()` of a middleware, the `.server()` of an isomorphic function,
 * and a file route's `server` option. The compiler then drops module-level declarations that only
 * stripped code used, so a use inside an unexported helper is fine when every use of the helper
 * is. Type-only imports are always allowed, and `.server` modules may import each other. Test
 * files are not checked (the config leaves them out).
 *
 * Limits: the stripped places are matched by name, so a renamed import of `createServerFn` is not
 * recognised, and a value re-exported through a plain module is caught only in that module.
 */

/** A specifier naming a `.server` module, e.g. `../server/rows.server` or `./env.server.ts`. */
const SERVER_MODULE = /\.server(\.[cm]?[jt]sx?)?$/;
/** A file that is itself a `.server` module. */
const SERVER_FILE = /\.server\.[cm]?[jt]sx?$/;

/** The name a call is made through: `createServerFn` for `createServerFn(...)`, else undefined. */
function calleeName(node) {
  if (node.type !== 'CallExpression') return undefined;
  if (node.callee.type === 'Identifier') return node.callee.name;
  if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
    return node.callee.property.name;
  }
  return undefined;
}

/** The call a method chain starts from: `createServerFn()` for `createServerFn().a().b()`. */
function chainRoot(call) {
  let node = call;
  while (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'CallExpression'
  ) {
    node = node.callee.object;
  }
  return node;
}

/** The methods of each builder whose arguments the client bundle strips. */
const STRIPPED_METHODS = new Map([
  ['createServerFn', new Set(['handler', 'validator', 'inputValidator'])],
  ['createMiddleware', new Set(['server', 'validator', 'inputValidator'])],
  ['createIsomorphicFn', new Set(['server'])],
]);

/** Whether the arguments of `call` are code the Start compiler leaves out of the client. */
function isStrippedArgument(call) {
  if (call.callee.type === 'Identifier') return call.callee.name === 'createServerOnlyFn';
  const methods = STRIPPED_METHODS.get(calleeName(chainRoot(call)));
  return methods?.has(calleeName(call)) ?? false;
}

/** Whether `node` is the `server` option of `createFileRoute(path)({ ... })`. */
function isServerRouteOption(node) {
  if (node.type !== 'Property' || node.computed) return false;
  const key = node.key.type === 'Identifier' ? node.key.name : node.key.value;
  if (key !== 'server') return false;
  const options = node.parent;
  const call = options.parent;
  return (
    call.type === 'CallExpression' &&
    call.arguments[0] === options &&
    calleeName(call.callee) === 'createFileRoute'
  );
}

/** Module-level statements the compiler drops once nothing outside stripped code uses them. */
const DROPPABLE = new Set(['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclaration']);

/** The references that read a variable at run time: not its declaration, not uses as a type. */
const valueReferences = (variable) =>
  variable.references.filter((r) => !r.init && r.isValueReference !== false);
/** Whether an import, export or one of their specifiers is `type` only, so erased at build. */
const isTypeOnly = (node) => node.importKind === 'type' || node.exportKind === 'type';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Runtime values from `.server` modules must not reach client code.' },
    schema: [],
    messages: {
      value:
        "`{{name}}` from '{{source}}' is used outside server-only code, so the browser gets a stripped module: move it to a module without `.server`, or use it only inside a server function's handler.",
      sideEffect:
        "'{{source}}' is a `.server` module, which the browser bundle leaves out: import it from a `.server` module or a server function.",
      reexport:
        "Re-exporting values from '{{source}}' hands a `.server` module to client code: re-export types only (`export type`).",
      dynamic:
        "'{{source}}' is a `.server` module, which the browser bundle leaves out: load it only inside server-only code.",
    },
  },
  create(context) {
    if (SERVER_FILE.test(context.filename)) return {};
    const { sourceCode } = context;

    /** Whether each module-level statement is left out of the client bundle, once known. */
    const dropped = new Map();
    /** The statements whose answer is being worked out: a helper that reaches one is assumed dropped. */
    const pending = new Set();

    /** Whether the client bundle drops `statement`, a module-level statement. */
    function isDropped(statement) {
      if (!DROPPABLE.has(statement.type)) return false;
      if (dropped.has(statement)) return dropped.get(statement);
      if (pending.has(statement)) return true;
      pending.add(statement);
      const result = sourceCode
        .getDeclaredVariables(statement)
        .every((variable) => valueReferences(variable).every((r) => isServerOnly(r.identifier)));
      pending.delete(statement);
      // `true` may rest on a pending statement that turns out to stay, so keep it only when final.
      if (!result || pending.size === 0) dropped.set(statement, result);
      return result;
    }

    /** Whether `node` sits inside code the Start compiler leaves out of the client. */
    function isServerOnly(node) {
      for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
        if (parent.type === 'CallExpression' && parent.arguments.includes(child)) {
          if (isStrippedArgument(parent)) return true;
        }
        if (isServerRouteOption(parent) && parent.value === child) return true;
        if (parent.type === 'Program') return isDropped(child);
      }
      return false;
    }

    /** The specifier of an import or export from a `.server` module, else undefined. */
    const serverSource = (node) =>
      node.source?.type === 'Literal' &&
      typeof node.source.value === 'string' &&
      SERVER_MODULE.test(node.source.value)
        ? node.source.value
        : undefined;

    return {
      ImportDeclaration(node) {
        const source = serverSource(node);
        if (!source || isTypeOnly(node)) return;
        if (node.specifiers.length === 0) {
          context.report({ node, messageId: 'sideEffect', data: { source } });
          return;
        }
        for (const specifier of node.specifiers) {
          if (isTypeOnly(specifier)) continue;
          const [variable] = sourceCode.getDeclaredVariables(specifier);
          const references = variable ? valueReferences(variable) : [];
          const leak = references.find((r) => !isServerOnly(r.identifier));
          // A binding nothing reads still pulls the module into the client graph.
          if (leak || references.length === 0) {
            context.report({
              node: leak?.identifier ?? specifier,
              messageId: 'value',
              data: { name: specifier.local.name, source },
            });
          }
        }
      },
      'ExportNamedDeclaration, ExportAllDeclaration'(node) {
        const source = serverSource(node);
        if (!source || isTypeOnly(node)) return;
        if (node.type === 'ExportNamedDeclaration' && node.specifiers.every(isTypeOnly)) return;
        context.report({ node, messageId: 'reexport', data: { source } });
      },
      ImportExpression(node) {
        const source = serverSource(node);
        if (source && !isServerOnly(node)) {
          context.report({ node, messageId: 'dynamic', data: { source } });
        }
      },
    };
  },
};

export const serverImportsPlugin = { rules: { 'no-client-server-imports': rule } };
