class EndemicComponent extends HTMLDivElement {
    constructor() {
        super();
    }
}

class EndemicError extends Error {
    constructor(code, message) {
        super();
        this.code = code;
        this.message = message;
    }
}

customElements.define("endemic-definition", EndemicComponent, { extends: "div" });

let _imported = {};
let _registered = {};

const _moustacheRegex = /\${(.+?)}/g;

/**
 * 
 * @param {*} token 
 * @param {*} node 
 * @param {*} tokenString 
 */
const _pushToken = function(token, node, tokenString) {
    token.node = node;
    token.token = tokenString;
    token.key = tokenString.substring(2, tokenString.length - 1);

    this.tokens.push(token);

    if (!this.tokenIndex[token.key]) {
        this.tokenIndex[token.key] = [];
    }

    this.tokenIndex[token.key].push(token);
}

/**
 * Find all tokens that appear within a given node and bind them to the data-model.
 * @param {*} node 
 */
const _discoverTokens = function(node) {
    // Look-behinds not universally supported yet, so just rip out escaped braces before looking for tokens.
    let initialValue = (node.innerHTML || node.textContent);
    let content = initialValue.replace(/\\[{}]/, "");
    let nodeTokens = content.match(_moustacheRegex) || [];
    for(let j = 0; j < nodeTokens.length; j++) {
        _pushToken.call(this, { initialValue: initialValue }, node, nodeTokens[j]);
    }

    let observedAttr = [];
    if (node.attributes) {
        for (let j = 0; j < node.attributes.length; j++) {

            nodeTokens = (node.attributes[j].value || "").match(_moustacheRegex) || [];

            for(let l = 0; l < nodeTokens.length; l++) {
                _pushToken.call(this, { 
                    attributeName: node.attributes[j].name,
                    initialValue: node.attributes[j].value
                }, node, nodeTokens[l]);

                // If the token is the entire initial value, we want to put a watch on it.
                if (nodeTokens[l] === node.attributes[j].value) {
                    observedAttr.push(node.attributes[j].name);
                }
            }
        }
    }

    if (observedAttr.length) {
        let el = this;
        let _setAttribute = node.setAttribute;
        node.setAttribute = function(key, value) {
            if (observedAttr.includes(key)) {
                el[key] = value;
            }

            return _setAttribute.call(this, key, value);
        }
    }
}

// TODO - replace /all/ tokens within the given node at once.
const _updateToken = function(token) {
    let lastNode = null;

    if (token.attributeName) {
        // Replace tokens in attributes
        content = (token.node === lastNode)
            ? token.node.getAttribute(token.attributeName)
            : token.initialValue
        ;

        token.node.setAttribute(
            token.attributeName,
            content.replace(token.token, this[token.key] || "")
        );
    } else {
        // Replace token in textContent
        content = (token.node === lastNode) 
            ? token.node.textContent 
            : token.initialValue
        ;

        token.node.textContent = content.replace(token.token, this[token.key] || "");
    }
}

/**
 * 
 * @param {MutationRecord[]} change 
 */
const _onAttributeChange = function(changeList) {
    for(let i = 0; i < changeList.length; i++) {
        if (changeList[i].type === "attributes") {
            this[changeList[i].attributeName] = changeList[i].target.getAttribute(changeList[i].attributeName);
            (this.tokenIndex[changeList[i].attributeName] || []).forEach(_updateToken.bind(this));
        }
    }
};

const endemic = {

    /**
     * 
     * @param {function} type class or constructor.
     */
    register: function(type) {
        let component = document.currentScript.parentElement;
        if (!component instanceof EndemicComponent) {
            throw new EndemicError(1, "Can't call `register` in this context.");
        }
        if (!component.hasAttribute("data-name")) {
            throw new EndemicError(2, "endemic-definition requires a data-name attribute");
        }

        let container = component.cloneNode(true);
        let name = component.getAttribute("data-name");
        if (_registered[name]) {
            return;
        }

        _registered[name] = class extends type {
            /**
             * 
             */
            constructor() {
                super();
                for(let i = 0; i < this.attributes.length; i++) {
                    this[this.attributes[i].name] = this.attributes[i].value;
                }

                if (!this.shadowRoot) {
                    this.attachShadow({ mode : "open" });
                }

                this.tokens = [];
                this.tokenIndex = {};

                for (let i = 0; i < container.childNodes.length; i++) {
                    if (
                        container.childNodes[i] instanceof HTMLElement
                        && !(container.childNodes[i] instanceof HTMLScriptElement)
                    ) {
                        let node = container.childNodes[i].cloneNode(true);
                        this.shadowRoot.appendChild(node);
                    }
                }

                if (this.init instanceof Function) {
                    this.init();
                }

                for (let i = 0; i < this.shadowRoot.childNodes.length; i++) {
                    _discoverTokens.call(this, this.shadowRoot.childNodes[i]);
                }

                this.populate();

                this.mutationObserver = new MutationObserver(_onAttributeChange.bind(this));
                this.mutationObserver.observe(this, { attributes: true });
            }


            /**
             * 
             * @param {*} fragment 
             * @param {*} extraValues 
             */
            applyTokensToFragment(fragment, extraValues) {
                let tokenContainer = { tokens: [], tokenIndex: {} };
                for (let i = 0; i < fragment.childNodes.length; i++) {
                    _discoverTokens.call(tokenContainer, fragment.childNodes[i]);
                }

                this.populate.call(tokenContainer, extraValues);
            }            

            /**
             * 
             */
            discoverTokens() {
                var newTokens = [];
                // Remove tokens that are no longer relevant
                for(let i = 0; i < this.tokens; i++) {
                    if (this.tokens[i].node.parentElement) {
                        newTokens.push(this.tokens[i]);
                    }
                }

                this.tokens = newTokens;

                for (let i = 0; i < this.shadowRoot.childNodes.length; i++) {
                    _discoverTokens.call(this, this.shadowRoot.childNodes[i]);
                }                

                // TODO: Dedupe
            }

            /**
             * 
             */
            populate(extraValues) {
                var content;

                // Reset everything back to initial value before we start applying tokens.
                for(let i = 0; i < this.tokens.length; i++) {
                    if (this.tokens[i].attributeName) {
                        this.tokens[i].node.setAttribute(this.tokens[i].attributeName, this.tokens[i].initialValue);
                    } else {
                        if (this.tokens[i].node.innerHTML) {
                            this.tokens[i].node.innerHTML = this.tokens[i].initialValue;                            
                        } else {
                            this.tokens[i].node.textContent = this.tokens[i].initialValue;
                        }                        
                    }
                }

                let source = extraValues || this;
                for(let i = 0; i < this.tokens.length; i++) {
                    if (source[this.tokens[i].key] === void 0) {
                        continue;
                    }

                    if (this.tokens[i].attributeName) {
                        // Replace tokens in attributes
                        content = this.tokens[i].node.getAttribute(this.tokens[i].attributeName);

                        this.tokens[i].node.setAttribute(
                            this.tokens[i].attributeName,
                            content.replace(this.tokens[i].token, source[this.tokens[i].key])
                        );
                    } else {
                        // Replace token in textContent
                        content = (this.tokens[i].node.innerHTML || this.tokens[i].node.textContent);

                        if (this.tokens[i].node.innerHTML) {
                            this.tokens[i].node.innerHTML = content.replace(this.tokens[i].token, source[this.tokens[i].key]);                            
                        } else {
                            this.tokens[i].node.textContent = content.replace(this.tokens[i].token, source[this.tokens[i].key]);
                        }
                    }
                }
            }
        };

        customElements.define(name, _registered[name]);

        component.parentElement.removeChild(component);
    },

    import: function(componentName) {
        if (_imported[componentName]) {
            return;
        }
        _imported[componentName] = "loaded";

        var request = new XMLHttpRequest();
        request.addEventListener("load", function() {
            if (this.status !== 200) {
                _imported[componentName] = "failed";
            }

            // Needed to cause the actual scripts to run.
            let range = document.createRange();
            range.selectNode(document.getElementsByTagName("body")[0]);
            document.body.appendChild(range.createContextualFragment(this.responseText));
        });

        var onFail = function() {
            _imported[componentName] = "failed";
        };

        request.addEventListener("error", onFail);
        request.addEventListener("abort", onFail);

        request.open("GET", `${componentName}.html`);
        request.send();
    }
};

window.Endemic = endemic;
