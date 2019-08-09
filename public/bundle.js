var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function flush() {
        const seen_callbacks = new Set();
        do {
            // first, call beforeUpdate functions
            // and update components
            while (dirty_components.length) {
                const component = dirty_components.shift();
                set_current_component(component);
                update(component.$$);
            }
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    callback();
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
    }
    function update($$) {
        if ($$.fragment) {
            $$.update($$.dirty);
            run_all($$.before_update);
            $$.fragment.p($$.dirty, $$.ctx);
            $$.dirty = null;
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        if (component.$$.fragment) {
            run_all(component.$$.on_destroy);
            component.$$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            component.$$.on_destroy = component.$$.fragment = null;
            component.$$.ctx = {};
        }
    }
    function make_dirty(component, key) {
        if (!component.$$.dirty) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty = blank_object();
        }
        component.$$.dirty[key] = true;
    }
    function init(component, options, instance, create_fragment, not_equal, prop_names) {
        const parent_component = current_component;
        set_current_component(component);
        const props = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props: prop_names,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty: null
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, props, (key, value) => {
                if ($$.ctx && not_equal($$.ctx[key], $$.ctx[key] = value)) {
                    if ($$.bound[key])
                        $$.bound[key](value);
                    if (ready)
                        make_dirty(component, key);
                }
            })
            : props;
        $$.update();
        ready = true;
        run_all($$.before_update);
        $$.fragment = create_fragment($$.ctx);
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error(`'target' is a required option`);
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn(`Component was already destroyed`); // eslint-disable-line no-console
            };
        }
    }

    /* app\User.svelte generated by Svelte v3.7.1 */

    const file = "app\\User.svelte";

    function create_fragment(ctx) {
    	var div, img, img_alt_value, t0, h3, t1;

    	return {
    		c: function create() {
    			div = element("div");
    			img = element("img");
    			t0 = space();
    			h3 = element("h3");
    			t1 = text(ctx.username);
    			attr(img, "src", ctx.avatar);
    			attr(img, "alt", img_alt_value = "" + ctx.username + "'s Avatar'");
    			attr(img, "class", "svelte-1c3tlvw");
    			add_location(img, file, 26, 4, 445);
    			attr(h3, "class", "svelte-1c3tlvw");
    			add_location(h3, file, 27, 4, 496);
    			attr(div, "class", "user svelte-1c3tlvw");
    			add_location(div, file, 25, 0, 421);
    		},

    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},

    		m: function mount(target, anchor) {
    			insert(target, div, anchor);
    			append(div, img);
    			append(div, t0);
    			append(div, h3);
    			append(h3, t1);
    		},

    		p: function update(changed, ctx) {
    			if (changed.avatar) {
    				attr(img, "src", ctx.avatar);
    			}

    			if ((changed.username) && img_alt_value !== (img_alt_value = "" + ctx.username + "'s Avatar'")) {
    				attr(img, "alt", img_alt_value);
    			}

    			if (changed.username) {
    				set_data(t1, ctx.username);
    			}
    		},

    		i: noop,
    		o: noop,

    		d: function destroy(detaching) {
    			if (detaching) {
    				detach(div);
    			}
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { username, avatar } = $$props;

    	const writable_props = ['username', 'avatar'];
    	Object.keys($$props).forEach(key => {
    		if (!writable_props.includes(key) && !key.startsWith('$$')) console.warn(`<User> was created with unknown prop '${key}'`);
    	});

    	$$self.$set = $$props => {
    		if ('username' in $$props) $$invalidate('username', username = $$props.username);
    		if ('avatar' in $$props) $$invalidate('avatar', avatar = $$props.avatar);
    	};

    	return { username, avatar };
    }

    class User extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, ["username", "avatar"]);

    		const { ctx } = this.$$;
    		const props = options.props || {};
    		if (ctx.username === undefined && !('username' in props)) {
    			console.warn("<User> was created without expected prop 'username'");
    		}
    		if (ctx.avatar === undefined && !('avatar' in props)) {
    			console.warn("<User> was created without expected prop 'avatar'");
    		}
    	}

    	get username() {
    		throw new Error("<User>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set username(value) {
    		throw new Error("<User>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get avatar() {
    		throw new Error("<User>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set avatar(value) {
    		throw new Error("<User>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* app\UserSearch.svelte generated by Svelte v3.7.1 */

    const file$1 = "app\\UserSearch.svelte";

    // (37:4) {#if user}
    function create_if_block(ctx) {
    	var current;

    	var user_1 = new User({
    		props: {
    		username: ctx.user.login,
    		avatar: ctx.user.avatar_url
    	},
    		$$inline: true
    	});

    	return {
    		c: function create() {
    			user_1.$$.fragment.c();
    		},

    		m: function mount(target, anchor) {
    			mount_component(user_1, target, anchor);
    			current = true;
    		},

    		p: function update(changed, ctx) {
    			var user_1_changes = {};
    			if (changed.user) user_1_changes.username = ctx.user.login;
    			if (changed.user) user_1_changes.avatar = ctx.user.avatar_url;
    			user_1.$set(user_1_changes);
    		},

    		i: function intro(local) {
    			if (current) return;
    			transition_in(user_1.$$.fragment, local);

    			current = true;
    		},

    		o: function outro(local) {
    			transition_out(user_1.$$.fragment, local);
    			current = false;
    		},

    		d: function destroy(detaching) {
    			destroy_component(user_1, detaching);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	var div, h2, t1, form, input, t2, button, t4, current, dispose;

    	var if_block = (ctx.user) && create_if_block(ctx);

    	return {
    		c: function create() {
    			div = element("div");
    			h2 = element("h2");
    			h2.textContent = "Search for Users";
    			t1 = space();
    			form = element("form");
    			input = element("input");
    			t2 = space();
    			button = element("button");
    			button.textContent = "Search";
    			t4 = space();
    			if (if_block) if_block.c();
    			attr(h2, "class", "svelte-w8fifq");
    			add_location(h2, file$1, 29, 4, 565);
    			attr(input, "type", "text");
    			add_location(input, file$1, 32, 8, 639);
    			add_location(button, file$1, 33, 8, 695);
    			add_location(form, file$1, 31, 4, 598);
    			attr(div, "class", "user-search svelte-w8fifq");
    			add_location(div, file$1, 28, 0, 534);

    			dispose = [
    				listen(input, "input", ctx.input_input_handler),
    				listen(form, "submit", ctx.handleSubmit)
    			];
    		},

    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},

    		m: function mount(target, anchor) {
    			insert(target, div, anchor);
    			append(div, h2);
    			append(div, t1);
    			append(div, form);
    			append(form, input);

    			input.value = ctx.usernameQuery;

    			append(form, t2);
    			append(form, button);
    			append(div, t4);
    			if (if_block) if_block.m(div, null);
    			current = true;
    		},

    		p: function update(changed, ctx) {
    			if (changed.usernameQuery && (input.value !== ctx.usernameQuery)) input.value = ctx.usernameQuery;

    			if (ctx.user) {
    				if (if_block) {
    					if_block.p(changed, ctx);
    					transition_in(if_block, 1);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div, null);
    				}
    			} else if (if_block) {
    				group_outros();
    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});
    				check_outros();
    			}
    		},

    		i: function intro(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},

    		o: function outro(local) {
    			transition_out(if_block);
    			current = false;
    		},

    		d: function destroy(detaching) {
    			if (detaching) {
    				detach(div);
    			}

    			if (if_block) if_block.d();
    			run_all(dispose);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let usernameQuery = '';
        let user;

        function handleSubmit(e) {
            e.preventDefault();

            fetch(`https://api.github.com/users/${usernameQuery}`)
                .then(resp => resp.json())
                .then(data => { const $$result = (user = data); $$invalidate('user', user); return $$result; });
        }

    	function input_input_handler() {
    		usernameQuery = this.value;
    		$$invalidate('usernameQuery', usernameQuery);
    	}

    	return {
    		usernameQuery,
    		user,
    		handleSubmit,
    		input_input_handler
    	};
    }

    class UserSearch extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, []);
    	}
    }

    /* app\App.svelte generated by Svelte v3.7.1 */

    const file$2 = "app\\App.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = Object.create(ctx);
    	child_ctx.user = list[i];
    	return child_ctx;
    }

    // (37:4) {#if users}
    function create_if_block$1(ctx) {
    	var ul, current;

    	var each_value = ctx.users;

    	var each_blocks = [];

    	for (var i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	return {
    		c: function create() {
    			ul = element("ul");

    			for (var i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}
    			attr(ul, "class", "user-list svelte-1mp4ji1");
    			add_location(ul, file$2, 37, 8, 695);
    		},

    		m: function mount(target, anchor) {
    			insert(target, ul, anchor);

    			for (var i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(ul, null);
    			}

    			current = true;
    		},

    		p: function update(changed, ctx) {
    			if (changed.users) {
    				each_value = ctx.users;

    				for (var i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(changed, child_ctx);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(ul, null);
    					}
    				}

    				group_outros();
    				for (i = each_value.length; i < each_blocks.length; i += 1) out(i);
    				check_outros();
    			}
    		},

    		i: function intro(local) {
    			if (current) return;
    			for (var i = 0; i < each_value.length; i += 1) transition_in(each_blocks[i]);

    			current = true;
    		},

    		o: function outro(local) {
    			each_blocks = each_blocks.filter(Boolean);
    			for (let i = 0; i < each_blocks.length; i += 1) transition_out(each_blocks[i]);

    			current = false;
    		},

    		d: function destroy(detaching) {
    			if (detaching) {
    				detach(ul);
    			}

    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    // (39:12) {#each users as user}
    function create_each_block(ctx) {
    	var current;

    	var user = new User({
    		props: {
    		username: ctx.user.login,
    		avatar: ctx.user.avatar_url
    	},
    		$$inline: true
    	});

    	return {
    		c: function create() {
    			user.$$.fragment.c();
    		},

    		m: function mount(target, anchor) {
    			mount_component(user, target, anchor);
    			current = true;
    		},

    		p: function update(changed, ctx) {
    			var user_changes = {};
    			if (changed.users) user_changes.username = ctx.user.login;
    			if (changed.users) user_changes.avatar = ctx.user.avatar_url;
    			user.$set(user_changes);
    		},

    		i: function intro(local) {
    			if (current) return;
    			transition_in(user.$$.fragment, local);

    			current = true;
    		},

    		o: function outro(local) {
    			transition_out(user.$$.fragment, local);
    			current = false;
    		},

    		d: function destroy(detaching) {
    			destroy_component(user, detaching);
    		}
    	};
    }

    function create_fragment$2(ctx) {
    	var main, t, current;

    	var usersearch = new UserSearch({ $$inline: true });

    	var if_block = (ctx.users) && create_if_block$1(ctx);

    	return {
    		c: function create() {
    			main = element("main");
    			usersearch.$$.fragment.c();
    			t = space();
    			if (if_block) if_block.c();
    			add_location(main, file$2, 34, 0, 643);
    		},

    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},

    		m: function mount(target, anchor) {
    			insert(target, main, anchor);
    			mount_component(usersearch, main, null);
    			append(main, t);
    			if (if_block) if_block.m(main, null);
    			current = true;
    		},

    		p: function update(changed, ctx) {
    			if (ctx.users) {
    				if (if_block) {
    					if_block.p(changed, ctx);
    					transition_in(if_block, 1);
    				} else {
    					if_block = create_if_block$1(ctx);
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(main, null);
    				}
    			} else if (if_block) {
    				group_outros();
    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});
    				check_outros();
    			}
    		},

    		i: function intro(local) {
    			if (current) return;
    			transition_in(usersearch.$$.fragment, local);

    			transition_in(if_block);
    			current = true;
    		},

    		o: function outro(local) {
    			transition_out(usersearch.$$.fragment, local);
    			transition_out(if_block);
    			current = false;
    		},

    		d: function destroy(detaching) {
    			if (detaching) {
    				detach(main);
    			}

    			destroy_component(usersearch);

    			if (if_block) if_block.d();
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	

        let users;

        function getGithubUsers() {
            fetch('https://api.github.com/users')
                .then(resp => resp.json())
                .then(data => { const $$result = (users = data); $$invalidate('users', users); return $$result; });
        }

        onMount(() => {
            getGithubUsers();
        });

    	return { users };
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, []);
    	}
    }

    const app = new App({
        target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
