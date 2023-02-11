"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = void 0;
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const util_1 = __importDefault(require("util"));
class MissingServiceNameError extends Error {
}
class MissingCallbackError extends Error {
}
class InvalidPropertyTypeError extends Error {
}
const capitalizeFirstLetter = (string) => string[0].toUpperCase() + string.slice(1).toLowerCase();
const addIndent = (string, indentation, whitespace = '  ') => `${[...Array(indentation).keys()].map(_ => '  ').join('')}${string}`;
const indentEachLine = (string, indentation, whitespace = '  ') => string
    .split('\n')
    .map(e => addIndent(e, indentation, whitespace))
    .join('\n');
const formatRpcs = (rpcs) => rpcs
    .map(rpc => rpc
    .split('\n')
    .map(e => addIndent(e, 1))
    .join('\n'))
    .join('\n\n');
const service = (serviceName, rpcs) => `service Service {
  option (msp.net).alias = "${serviceName}";
        
${formatRpcs(rpcs)}
}`;
const rpc = (rpcName, serviceName, requestSchemaName, responseSchemaName, route, method, visibility = 'internal') => `rpc ${rpcName}( ${requestSchemaName} ) returns( ${responseSchemaName} ) {
    option (msp.http).templatedUrl  = "/${serviceName}${route}";
    option (msp.http).method = "${method}";
    option (msp.http).timeout = 5000;
    option (msp.http).visibility = "${visibility}";
    ${['POST', 'PUT', 'PATCH'].includes(method) ? 'option (msp.http).body = "request";' : ''}
}`;
function message(messageName, schema, indent = 0) {
    console.log(messageName, schema);
    if (schema.type === 'object') {
        return `message ${messageName} {
    ${Object.keys(schema.properties).map((key, index) => {
            return generateProperty(key, schema.properties[key], index, schema.required.includes(key), indent + 1);
        }).join('\n')}
}`;
    }
    return `${messageName}`;
}
function messageOneOf(messageName, schemas = [], indent = 0) {
    return `message ${messageName}OneOf {
  oneof types {
    ${schemas.map((schema, index) => {
        return generateProperty(schema.type, schema, index, false, indent + 1);
        /*schema.type === 'object'
        Object.keys(schema.properties).map((key, index) => {
            return
        })
         :*/
    }).join('\n')}
  }

  message ${messageName} {
    repeated types ${messageName}
  }
}`;
}
const protoTypeMap = {
    number: 'uint32',
    string: 'string',
};
const generateReadableRpcName = (route) => []
    .concat([route.method], ...route.url
    .split('-')
    .map(e => e.split('/')))
    .filter(e => e && e.length > 0) // remove empty elements caused by prepended slash in url
    .map(capitalizeFirstLetter)
    .map(e => e.replace(/:/g, 'By'))
    .join('');
function generateProperty(key, value, index, required, indent) {
    console.debug(key, value);
    let returnString = '';
    // Object
    if (value.type === 'object') {
        returnString = `${message(key + 'Object', value, indent)}
${required ? 'required ' : ''}${key + 'Object'} ${key} = ${index};`;
        // Arrays
    }
    else if (value.type === 'array') { // Arrays
        // Handles objects in arrays
        if (value.items.type === 'object') {
            returnString = `${message(key + 'Object', value.items, indent)}
${required ? 'required ' : ''}repeated ${key + 'Object'} ${key} = ${index};`;
        }
        else {
            returnString = `${required ? 'required ' : ''}repeated ${value.items.type} ${key} = ${index};`;
        }
        // Union types
    }
    else if (value.oneOf) {
        returnString = `${messageOneOf(key, value.oneOf, indent)}
${required ? 'required ' : ''}${key} ${key} = ${index};`;
        // Any type
    }
    else if (JSON.stringify(value) === '{}') {
        returnString = `google.protobuf.Any ${key} = ${index};`;
        // Built ins
    }
    else if (Object.keys(protoTypeMap).includes(value.type)) {
        returnString = `${required ? 'required ' : ''}${protoTypeMap[value.type]} ${key} = ${index};`;
    }
    console.log(Object.keys(protoTypeMap), value.type);
    if (!returnString) {
        console.error('Invalid type', key, value);
        throw new InvalidPropertyTypeError();
    }
    // Indent and return
    return indentEachLine(returnString, indent);
}
function addParams(fullParams, properties, required) {
    fullParams.properties = Object.assign(fullParams.properties, properties);
    fullParams.required = fullParams.required.concat(required !== null && required !== void 0 ? required : []);
}
exports.plugin = (0, fastify_plugin_1.default)(function (instance, options, done) {
    console.log('Started print routes');
    if (typeof options.callback !== 'function') {
        throw new MissingCallbackError();
    }
    const routes = [];
    let swagger = null;
    // Utility to track all the RouteOptions we add
    instance.addHook('onRoute', route => {
        console.debug('Added route', util_1.default.inspect(route, { showHidden: false, depth: null, colors: true }));
        routes.push(route);
    });
    instance.addHook('onReady', done => {
        var _a;
        const swagger = instance.swagger();
        console.log('This is the swagger', swagger);
        const serviceName = (_a = options.serviceName) !== null && _a !== void 0 ? _a : swagger.info.title;
        if (!serviceName) {
            throw new MissingServiceNameError();
        }
        const messages = []; // Object structures
        const rpcs = []; // Routes
        for (let i = 0; i < routes.length; i++) {
            const route = routes[i];
            let params = {
                type: 'object',
                properties: {},
                required: []
            };
            const routeSchema = route.schema;
            if (routeSchema) {
                if (routeSchema.body) {
                    const body = routeSchema.body;
                    addParams(params, body.properties, body.required);
                }
                if (routeSchema.params) {
                    const pathParams = routeSchema.params;
                    addParams(params, pathParams.properties, pathParams.required);
                }
                if (routeSchema.querystring) {
                    const querystring = routeSchema.querystring;
                    addParams(params, querystring.querystring, querystring.required);
                }
            }
            try {
                // Generate a readable name
                const rpcName = generateReadableRpcName(route);
                rpcs.push(rpc(rpcName, serviceName, Object.keys(params.properties).length > 0
                    ? `${rpcName}Request` : 'google.protobuf.Empty', routeSchema ? `${rpcName}Response` : 'string', route.url, route.method.toString()));
                console.log(params.properties);
                if (Object.keys(params.properties).length > 0) {
                    messages.push(message(`${rpcName}Request`, params));
                }
                if (routeSchema && routeSchema.response) {
                    messages.push(message(`${rpcName}Response`, routeSchema.response['200']));
                }
            }
            catch (e) {
                console.error(e, route);
                throw e;
            }
        }
        options.callback([]
            .concat(messages, [service(serviceName, rpcs)])
            .join('\n\n'));
        done();
    });
    done();
}, { name: 'fastify-generate-proto3' });
exports.default = exports.plugin;
//# sourceMappingURL=index.js.map