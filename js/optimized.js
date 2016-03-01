/**
 * @license almond 0.2.9 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that "directory" and not name of the baseName's
                //module. For instance, baseName of "one/two/three", maps to
                //"one/two/three.js", but we want the directory, "one/two" for
                //this normalization.
                baseParts = baseParts.slice(0, baseParts.length - 1);
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                name = baseParts.concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            return req.apply(undef, aps.call(arguments, 0).concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../components/almond/almond", function(){});

/*

LiveAddress API Interface for Javascript (unofficial)
by SmartyStreets
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

A helpful library for using LiveAddress while abstracting
away the JSONP requests and other lower-level operations.
We advise against using this code in production without
thorough testing in your own system. This library does not
handle the raw JSON output except return it to your calling
functions. No other dependencies required (not even jQuery).

Always call "LiveAddress.init('1234567...')" first, replacing
"1234567..." with your HTML key. Then for each call
to LiveAddress, supply a callback function to handle
the output.


EXAMPLES
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
(When you pass in an address, you can pass in an object
which maps fields to their values, a string being a freeform
address, a string being the ID of an HTML input/textarea
element which contains a value, or an array of any of the
above to do asyncrhonous batch requests.)

LiveAddress.verify({
	street: "123 main",
	street2: "apt 105",
	city: "denver",
	state: "colorado",
	zipcode: "12345"
}, function(json) { ... });


LiveAddress.verify("123 main st, 12345", function(json) {
	// 'json' contains the complete raw JSON response
	...
});


LiveAddress.geocode("address-textbox", function(geo) {
	// 'geo' is an object: lat, lon, coords, precision
	...
});


LiveAddress.county("500 fir, denver co", function(cty) {
	// 'cty' contains the county name
	...
});


LiveAddress.components("123 main 12345", function(comp) {
	// 'comp' is the components of a freeform address
	...
});


You can also pass in a timeout callback as the last parameter,
which is executed in case the query times out (a timeout is 3
failed attempts, where we wait 3.5 seconds for each one). The
input values are passed back to the timeout function as they were
received (except if a string was passed in the value comes
back as an object with the string in the "street" field.)

*/

define('liveaddress',[], function() {
window.LiveAddress = (function()
{
	var _id, _token;
	var _requests = {};
	var _batches = {};
	var _timers = {};
	var _counter = 0;
	var _candidates = 5;	// You can customize this: maximum results per address
	var _timeout = 3500;	// Milliseconds until a timeout is counted ("1 attempt")
	var _maxAttempts = 3;	// Maximum number of attempts for a single request before finally timing out

	function _buildFreeformRequest(addr, callback, timeout, wrapper)
	{
		// Here we expect addr to be a string (ID or actual address)
		var elem = document.getElementById(addr);
		return _buildComponentizedRequest({ street: (elem ? elem.value : addr) }, callback, timeout, wrapper);
	}

	function _buildComponentizedRequest(addr, callback, timeout, wrapper)
	{
		// We expect addr to be at least one object, mapping fields to values
		if (!addr)
			return null;

		var reqids = [], batch = {};
		var batch_id = "batch_" + (_counter++);

		addr = addr instanceof Array ? addr : [addr];

		_batches[batch_id] = {
			size: addr.length,
			returned: 0,
			json: [],
			userCallback: callback,
			wrap: wrapper || function(data) { return data; }
		};

		for (var idx in addr)
			reqids.push(_buildRequest(addr[idx], batch_id, idx, timeout));

		return reqids;
	}

	function _buildRequest(addr, batch_id, index, timeout)
	{
		var address = { fields: addr };

		address.id = "addr_" + (_counter++);
		address.inputIndex = parseInt(index, 10);
		address.json = [];
		address.batch = batch_id;
		address.userTimeout = timeout;
		address.callback = function(response) { _callback(address.id, response); };
		_requests[address.id] = address;
		return address.id;
	}

	function _queryString(reqid)
	{
		var request = _requests[reqid], qs;
		if (_id && _token)
			qs = "?auth-id=" + _id + "&auth-token=" + _token + "&candidates=" + _candidates;
		else
			qs = "?auth-token=" + _id + "&candidates=" + _candidates;
		for (var prop in request.fields)
			qs += "&" + prop + "=" + encodeURIComponent(request.fields[prop]);
		qs += "&callback=" + encodeURIComponent("LiveAddress.request(\"" + reqid + "\").callback");
		return qs;
	}

	function _request(reqids)
	{
		for (var i in reqids)
		{
			var dom = document.createElement("script");
			dom.src = "https://api.smartystreets.com/street-address"
				+ _queryString(reqids[i]);
			document.getElementsByTagName('head')[0].appendChild(dom);
			_requests[reqids[i]].DOM = dom;
			_timers[reqids[i]] = {
				attempts: _timers[reqids[i]] ? _timers[reqids[i]].attempts || 0 : 0,
				timeoutID: setTimeout(_timeoutHandler(reqids[i]), _timeout)
			};
		}
	}

	function _callback(reqid, data)
	{
		var request = _requests[reqid];
		var batch = _batches[request.batch];

		for (var i in data)
			data[i].input_index = request.inputIndex;
		batch.json = batch.json.concat(data);

		document.getElementsByTagName('head')[0].removeChild(request.DOM);
		delete _requests[reqid];

		clearTimeout(_timers[reqid].timeoutID);
		delete _timers[reqid];

		if (++batch.returned == batch.size)
		{
			var result = batch.userCallback(batch.wrap(batch.json));
			delete _batches[request.batch];
			return result;
		}
	}

	function _timeoutHandler(reqid)
	{
		return function()
		{
			if (++_timers[reqid].attempts < _maxAttempts)
				_request([reqid]);
			else if (typeof _requests[reqid].userTimeout === 'function')
				_requests[reqid].userTimeout(_requests[reqid].fields);
		};
	}

	function _coordinates(responseAddress)
	{
		if (!responseAddress || typeof responseAddress !== 'object')
			return undefined;

		return {
			lat: responseAddress.metadata.latitude,
			lon: responseAddress.metadata.longitude,
			precision: responseAddress.metadata.precision,
			coords: responseAddress.metadata.latitude + ", " + responseAddress.metadata.longitude
		};
	}






	return {
		init: function(authId, authToken)
		{
			_id = encodeURIComponent(authId || "");
			_token = encodeURIComponent(authToken || "");
		},

		verify: function(addr, callback, timeout, wrapper)
		{
			var reqids;

			if (typeof addr === "string")
				reqids = _buildFreeformRequest(addr, callback, timeout, wrapper);

			else if (typeof addr === "object" && !(addr instanceof Array))
				reqids = _buildComponentizedRequest(addr, callback, timeout, wrapper);

			else if (addr instanceof Array)
			{
				var addresses = [];		// Batch request
				for (var idx in addr)
				{
					if (typeof addr[idx] == "string")
					{
						var elem = document.getElementById(addr);
						addresses.push({ street: (elem ? elem.value : addr[idx]) });
					}
					else
						addresses.push(addr[idx]);
				}
				reqids = _buildComponentizedRequest(addresses, callback, timeout, wrapper);
			}

			_request(reqids);
		},

		request: function(reqid)	// For internal use only; must be accessible from the outside (when a JSONP request succeeds)
		{
			return _requests[reqid];
		},

		geocode: function(addr, callback, timeout)
		{
			this.verify(addr, callback, timeout, function(data)
			{
				if (data.length == 1)
					return _coordinates(data[0]);
				else
				{
					var coords = [];
					for (var i in data)
						coords.push(_coordinates(data[i]));
					return coords;
				}
			});
		},

		components: function(addr, callback, timeout)
		{
			this.verify(addr, callback, timeout, function(data)
			{
				var comp = [];
				for (var idx in data)
				{
					data[idx].components.first_line = data[idx].delivery_line_1;
					if (typeof data[idx].delivery_line_2 !== "undefined")
						data[idx].components.first_line += " " + data[idx].delivery_line_2;
					data[idx].components.last_line = data[idx].last_line;
					if (typeof data[idx].addressee !== "undefined")
						data[idx].components.addressee = data[idx].addressee;
					comp.push(data[idx].components);
				}
				return comp;
			});
		},

		county: function(addr, callback, timeout)
		{
			this.verify(addr, callback, timeout, function(data) {
				return data[0].metadata.county_name;
			});
		}
	};

})();
return window.LiveAddress;
});
define('validate-address',['liveaddress'], function(liveaddress) {
	

	return function() {

		var $input = $('#big-input');
		var $go = $('#go-button');
		var $loader = $('#loading');


		// Loader stuff
		var showLoader = function() {
			$loader.addClass('show');
		}

		var hideLoader = function() {
			$loader.removeClass('show');
		}


		// Tooltip stuff
		var tooltipVisible = false;
		var hasTooltip = false;

		var showTooltip = function(message) {
			if (hasTooltip) {
				$input.tooltip('destroy');
			}

			$input.tooltip({
				title: message,
				trigger: 'manual'
			});

			$input.tooltip('show');
			hasTooltip = true;
			tooltipVisible = true;
		}

		var hideTooltip = function() {
			if (tooltipVisible) {
				$input.tooltip('hide');
				tooltipVisible = false;
			}
		}

		var parseAddress = function() {
			var address = $.trim($input.val());

			if (address.length === 0) {
				showTooltip("Enter a 9-digit ZIP or a full street address");
				return false;
			}

			var matches;

			matches = address.match(/(\d\d\d\d\d)[-\s]?(\d\d\d\d)/);

			if (matches) {
				return { zip: matches[1] + matches[2] };
			}

			matches = address.match(/^\d\d\d\d\d$/);

			if (matches) {
				showTooltip("Enter a full 9-digit ZIP, like 12345-6789");
				return false;
			}

			if (!address.match(/\d\d\d\d\d/)) {
				showTooltip("Address should be in the format 123 Main St. City State ZIP");
				return false;
			}

			return { address: address };
		}

		var checkCodeAndRedirect = function(zip) {
			$.ajax('/check/' + zip)
				.done(function() {
					window.location.href = '/info/' + zip;
				})
				.fail(function(err) {
					hideLoader();
					if (err.status === 400) {
						showTooltip('Could not find the zip code ' + zip.substr(0, 5) + '-' + zip.substr(5, 4) + ' in our database.');
					} else if (err.status === 500) {
						showTooltip('There was a problem processing your request.  Please try again later.')
					} else {
						showTooltip('There was a problem contacting the server. Is you internet connection working?');
					}
				});
		}
		
		var go = function() {
			var result = parseAddress();
			if (result) {
				showLoader();
				if (result.address) {
				
					liveaddress.verify(result.address, function(data) {
						if (!data || data.length === 0) {
							hideLoader();
							showTooltip('Address not found, please check it and try again');
						} else {
							var zip = data[0].components.zipcode+data[0].components.plus4_code;

							if (data.length > 1) {
								for (var i = 1; i < data.length; ++i) {
									if (data[i].components.zipcode + data[i].components.plus4_code !== zip) {
										hideLoader();
										return showTooltip('Multiple addresses found, please check it and try again');
									}
								}
							}

							checkCodeAndRedirect(zip);
						}
					}, function() { 
						hideLoader();
						return showTooltip('There was a problem contacting the server.  Is you internet connection working?');
					});
				
				} else if (result.zip) {
					checkCodeAndRedirect(result.zip);
				}
			}
		};

		$go.on('click', function() {
			go();
		});

		$input.on('keyup', function(e) {
			hideTooltip();
			if (e.keyCode === 13) {
				go();
			}
		});

	};
});
define('email-subscribe',[], function() {
	

	

	return function() {
		var $emailButton = $('#email-button');
		var $emailRow = $('#email-row');
		var $emailInput = $('#email-input');

		$('a').click(function(){
			if ($.attr(this, 'anchor')) {
		    $('html, body').animate({
		        scrollTop: $( $.attr(this, 'anchor') ).offset().top - 55
		    }, 500);
		    //return false;
		  }
		});

		$('a').each(function(index, el) {
			var href = $(el).attr('href');
			if (href.indexOf('/tellus') === 0) {
				$(el).attr('href', href+'?source=' + encodeURIComponent(window.location.href));
			}
		});

		$emailInput.tooltip({
			title: "There was an error, please try again later.  Sorry!",
			trigger: 'manual'
		});

		$emailButton.on('click', function() {
			$emailInput.tooltip('hide');
			$.ajax({
				type: 'POST',
				url: '/subscribe/' + window.zipCode,
				data: { email: $emailInput.val() }
			}).done(function() {
				$emailRow.addClass('done');	
			})
			.fail(function(err) {
				$emailInput.tooltip('show');
			});
		});
	};
});
define('toggles',[], function() {
	

	

	return function() {
		var $showDemocrats = $('.show-democrats');
		var $showRepublicans = $('.show-republicans');
		var $showAll = $('.show-all');

		var $democratRaces = $('#main-container .race-container.party-D');
		var $republicanRaces = $('#main-container .race-container.party-R');
		var $otherRaces = $('#main-container .race-container.party-');

		var $showIncumbents = $('.show-incumbents');
		var $showEndorsed = $('.show-endorsed');
		var $showEveryone = $('.show-everyone');

		var $incumbentCandidatesBig = $('#main-container .candidate.incumbent');
		var $incumbentCandidatesSmall = $('#main-container .candidate-small.incumbent');
		var $endorsedCandidates = $('#main-container .candidate.endorsed');
		var $otherCandidatesBig = $('#main-container .candidate:not(.incumbent,.endorsed)');
		var $otherCandidatesSmall = $('#main-container .candidate-small:not(.incumbent,.endorsed)');

		$showDemocrats.on('click', function() {
			$democratRaces.show();
			$republicanRaces.hide();
			$otherRaces.hide();
		});

		$showRepublicans.on('click', function() {
			$democratRaces.hide();
			$republicanRaces.show();
			$otherRaces.hide();
		});

		$showAll.on('click', function() {
			$democratRaces.show();
			$republicanRaces.show();
			$otherRaces.show();
		});

		$showIncumbents.on('click', function() {
			$endorsedCandidates.hide();
			$otherCandidatesBig.hide();
			$otherCandidatesSmall.hide();
			$incumbentCandidatesBig.show();
			$incumbentCandidatesSmall.show();
		});

		$showEndorsed.on('click', function() {
			$otherCandidatesBig.hide();
			$otherCandidatesSmall.hide();
			$incumbentCandidatesBig.hide();
			$incumbentCandidatesSmall.hide();
			$endorsedCandidates.show();
		});

		$showEveryone.on('click', function() {
			$endorsedCandidates.show();
			$otherCandidatesBig.show();
			$otherCandidatesSmall.show();
			$incumbentCandidatesBig.show();
			$incumbentCandidatesSmall.show();
		});

	};
});
define('donate',[], function() {
	

	

	return function() {
		var $paypalDonateButton = $('#donatePaypalBtn');
		var $btcDonateButton = $('#donateBtnBtn');
		var $paypalDonation = $('#paypalDonation');
		var $btcDonation = $('#btcDonation');
		var $extraData = $('.extraData');
		var $fecOk = $('#fecOk');
		var $cbButton = $('#cbButton');

		var $fullname = $('#fullname');
		var $employer = $('#employer');
		var $occupation = $('#occupation');
		var $fullnameInput = $('#fullname input');
		var $employerInput = $('#employer input');
		var $occupationInput = $('#occupation input');
		var $ppDisclosureName = $('#os0');
		var $ppDisclosureEmployerOccupation = $('#os1');


		var donationType;
		var dataComplete = false;


		$fecOk.on('click', function() {

			var hasErrors = false;
			if (!$fullnameInput.val()) {
				$fullname.addClass('has-error');
				hasErrors = true;
			} else {
				$fullname.removeClass('has-error');
			}

			if (!$employerInput.val()) {
				$employer.addClass('has-error');
				hasErrors = true;
			} else {
				$employer.removeClass('has-error');
			}

			if (!$occupationInput.val()) {
				$occupation.addClass('has-error');
				hasErrors = true;
			} else {
				$occupation.removeClass('has-error');
			}

			if (hasErrors) {
				return;
			}

			$ppDisclosureName.val($fullnameInput.val());
			$ppDisclosureEmployerOccupation.val(
				$employerInput.val() + ' / ' + $occupationInput.val());

			$cbButton.html('<a class="coinbase-button" data-custom="'+
				$fullnameInput.val().replace('"', '') + ' / ' + $employerInput.val().replace('"', '') + " / " + $occupationInput.val().replace('"', '') + 
				'" data-code="8bf1a00748911620843aea280674d5aa" data-button-style="donation_large" href="https://coinbase.com/checkouts/8bf1a00748911620843aea280674d5aa">Donate Bitcoins</a><script src="https://coinbase.com/assets/button.js" type="text/javascript"></script>')

			dataComplete = true;
			$extraData.hide();
			
			if (donationType === 'paypal') {
				$paypalDonation.show();
				$btcDonation.hide();
			} else if (donationType === 'btc') {
				$paypalDonation.hide();
				$btcDonation.show();
			}
		});


		$paypalDonateButton.on('click', function() {
			donationType = 'paypal';
			$paypalDonateButton.addClass('active');
			$btcDonateButton.removeClass('active');
			if (dataComplete) {
				$paypalDonation.show();	
				$btcDonation.hide();
			} else {
				$extraData.show();
			}
		});

		$btcDonateButton.on('click', function() {
			donationType = 'btc';
			$paypalDonateButton.removeClass('active');
			$btcDonateButton.addClass('active');
			if (dataComplete) {
				$btcDonation.show();	
				$paypalDonation.hide();
			} else {
				$extraData.show();
			}
		});
	};
});
/* ========================================================================
 * Bootstrap: tooltip.js v3.1.1
 * http://getbootstrap.com/javascript/#tooltip
 * Inspired by the original jQuery.tipsy by Jason Frame
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  

  // TOOLTIP PUBLIC CLASS DEFINITION
  // ===============================

  var Tooltip = function (element, options) {
    this.type       =
    this.options    =
    this.enabled    =
    this.timeout    =
    this.hoverState =
    this.$element   = null

    this.init('tooltip', element, options)
  }

  Tooltip.DEFAULTS = {
    animation: true,
    placement: 'top',
    selector: false,
    template: '<div class="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner"></div></div>',
    trigger: 'hover focus',
    title: '',
    delay: 0,
    html: false,
    container: false
  }

  Tooltip.prototype.init = function (type, element, options) {
    this.enabled  = true
    this.type     = type
    this.$element = $(element)
    this.options  = this.getOptions(options)

    var triggers = this.options.trigger.split(' ')

    for (var i = triggers.length; i--;) {
      var trigger = triggers[i]

      if (trigger == 'click') {
        this.$element.on('click.' + this.type, this.options.selector, $.proxy(this.toggle, this))
      } else if (trigger != 'manual') {
        var eventIn  = trigger == 'hover' ? 'mouseenter' : 'focusin'
        var eventOut = trigger == 'hover' ? 'mouseleave' : 'focusout'

        this.$element.on(eventIn  + '.' + this.type, this.options.selector, $.proxy(this.enter, this))
        this.$element.on(eventOut + '.' + this.type, this.options.selector, $.proxy(this.leave, this))
      }
    }

    this.options.selector ?
      (this._options = $.extend({}, this.options, { trigger: 'manual', selector: '' })) :
      this.fixTitle()
  }

  Tooltip.prototype.getDefaults = function () {
    return Tooltip.DEFAULTS
  }

  Tooltip.prototype.getOptions = function (options) {
    options = $.extend({}, this.getDefaults(), this.$element.data(), options)

    if (options.delay && typeof options.delay == 'number') {
      options.delay = {
        show: options.delay,
        hide: options.delay
      }
    }

    return options
  }

  Tooltip.prototype.getDelegateOptions = function () {
    var options  = {}
    var defaults = this.getDefaults()

    this._options && $.each(this._options, function (key, value) {
      if (defaults[key] != value) options[key] = value
    })

    return options
  }

  Tooltip.prototype.enter = function (obj) {
    var self = obj instanceof this.constructor ?
      obj : $(obj.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type)

    clearTimeout(self.timeout)

    self.hoverState = 'in'

    if (!self.options.delay || !self.options.delay.show) return self.show()

    self.timeout = setTimeout(function () {
      if (self.hoverState == 'in') self.show()
    }, self.options.delay.show)
  }

  Tooltip.prototype.leave = function (obj) {
    var self = obj instanceof this.constructor ?
      obj : $(obj.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type)

    clearTimeout(self.timeout)

    self.hoverState = 'out'

    if (!self.options.delay || !self.options.delay.hide) return self.hide()

    self.timeout = setTimeout(function () {
      if (self.hoverState == 'out') self.hide()
    }, self.options.delay.hide)
  }

  Tooltip.prototype.show = function () {
    var e = $.Event('show.bs.' + this.type)

    if (this.hasContent() && this.enabled) {
      this.$element.trigger(e)

      if (e.isDefaultPrevented()) return
      var that = this;

      var $tip = this.tip()

      this.setContent()

      if (this.options.animation) $tip.addClass('fade')

      var placement = typeof this.options.placement == 'function' ?
        this.options.placement.call(this, $tip[0], this.$element[0]) :
        this.options.placement

      var autoToken = /\s?auto?\s?/i
      var autoPlace = autoToken.test(placement)
      if (autoPlace) placement = placement.replace(autoToken, '') || 'top'

      $tip
        .detach()
        .css({ top: 0, left: 0, display: 'block' })
        .addClass(placement)

      this.options.container ? $tip.appendTo(this.options.container) : $tip.insertAfter(this.$element)

      var pos          = this.getPosition()
      var actualWidth  = $tip[0].offsetWidth
      var actualHeight = $tip[0].offsetHeight

      if (autoPlace) {
        var $parent = this.$element.parent()

        var orgPlacement = placement
        var docScroll    = document.documentElement.scrollTop || document.body.scrollTop
        var parentWidth  = this.options.container == 'body' ? window.innerWidth  : $parent.outerWidth()
        var parentHeight = this.options.container == 'body' ? window.innerHeight : $parent.outerHeight()
        var parentLeft   = this.options.container == 'body' ? 0 : $parent.offset().left

        placement = placement == 'bottom' && pos.top   + pos.height  + actualHeight - docScroll > parentHeight  ? 'top'    :
                    placement == 'top'    && pos.top   - docScroll   - actualHeight < 0                         ? 'bottom' :
                    placement == 'right'  && pos.right + actualWidth > parentWidth                              ? 'left'   :
                    placement == 'left'   && pos.left  - actualWidth < parentLeft                               ? 'right'  :
                    placement

        $tip
          .removeClass(orgPlacement)
          .addClass(placement)
      }

      var calculatedOffset = this.getCalculatedOffset(placement, pos, actualWidth, actualHeight)

      this.applyPlacement(calculatedOffset, placement)
      this.hoverState = null

      var complete = function() {
        that.$element.trigger('shown.bs.' + that.type)
      }

      $.support.transition && this.$tip.hasClass('fade') ?
        $tip
          .one($.support.transition.end, complete)
          .emulateTransitionEnd(150) :
        complete()
    }
  }

  Tooltip.prototype.applyPlacement = function (offset, placement) {
    var replace
    var $tip   = this.tip()
    var width  = $tip[0].offsetWidth
    var height = $tip[0].offsetHeight

    // manually read margins because getBoundingClientRect includes difference
    var marginTop = parseInt($tip.css('margin-top'), 10)
    var marginLeft = parseInt($tip.css('margin-left'), 10)

    // we must check for NaN for ie 8/9
    if (isNaN(marginTop))  marginTop  = 0
    if (isNaN(marginLeft)) marginLeft = 0

    offset.top  = offset.top  + marginTop
    offset.left = offset.left + marginLeft

    // $.fn.offset doesn't round pixel values
    // so we use setOffset directly with our own function B-0
    $.offset.setOffset($tip[0], $.extend({
      using: function (props) {
        $tip.css({
          top: Math.round(props.top),
          left: Math.round(props.left)
        })
      }
    }, offset), 0)

    $tip.addClass('in')

    // check to see if placing tip in new offset caused the tip to resize itself
    var actualWidth  = $tip[0].offsetWidth
    var actualHeight = $tip[0].offsetHeight

    if (placement == 'top' && actualHeight != height) {
      replace = true
      offset.top = offset.top + height - actualHeight
    }

    if (/bottom|top/.test(placement)) {
      var delta = 0

      if (offset.left < 0) {
        delta       = offset.left * -2
        offset.left = 0

        $tip.offset(offset)

        actualWidth  = $tip[0].offsetWidth
        actualHeight = $tip[0].offsetHeight
      }

      this.replaceArrow(delta - width + actualWidth, actualWidth, 'left')
    } else {
      this.replaceArrow(actualHeight - height, actualHeight, 'top')
    }

    if (replace) $tip.offset(offset)
  }

  Tooltip.prototype.replaceArrow = function (delta, dimension, position) {
    this.arrow().css(position, delta ? (50 * (1 - delta / dimension) + '%') : '')
  }

  Tooltip.prototype.setContent = function () {
    var $tip  = this.tip()
    var title = this.getTitle()

    $tip.find('.tooltip-inner')[this.options.html ? 'html' : 'text'](title)
    $tip.removeClass('fade in top bottom left right')
  }

  Tooltip.prototype.hide = function () {
    var that = this
    var $tip = this.tip()
    var e    = $.Event('hide.bs.' + this.type)

    function complete() {
      if (that.hoverState != 'in') $tip.detach()
      that.$element.trigger('hidden.bs.' + that.type)
    }

    this.$element.trigger(e)

    if (e.isDefaultPrevented()) return

    $tip.removeClass('in')

    $.support.transition && this.$tip.hasClass('fade') ?
      $tip
        .one($.support.transition.end, complete)
        .emulateTransitionEnd(150) :
      complete()

    this.hoverState = null

    return this
  }

  Tooltip.prototype.fixTitle = function () {
    var $e = this.$element
    if ($e.attr('title') || typeof($e.attr('data-original-title')) != 'string') {
      $e.attr('data-original-title', $e.attr('title') || '').attr('title', '')
    }
  }

  Tooltip.prototype.hasContent = function () {
    return this.getTitle()
  }

  Tooltip.prototype.getPosition = function () {
    var el = this.$element[0]
    return $.extend({}, (typeof el.getBoundingClientRect == 'function') ? el.getBoundingClientRect() : {
      width: el.offsetWidth,
      height: el.offsetHeight
    }, this.$element.offset())
  }

  Tooltip.prototype.getCalculatedOffset = function (placement, pos, actualWidth, actualHeight) {
    return placement == 'bottom' ? { top: pos.top + pos.height,   left: pos.left + pos.width / 2 - actualWidth / 2  } :
           placement == 'top'    ? { top: pos.top - actualHeight, left: pos.left + pos.width / 2 - actualWidth / 2  } :
           placement == 'left'   ? { top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left - actualWidth } :
        /* placement == 'right' */ { top: pos.top + pos.height / 2 - actualHeight / 2, left: pos.left + pos.width   }
  }

  Tooltip.prototype.getTitle = function () {
    var title
    var $e = this.$element
    var o  = this.options

    title = $e.attr('data-original-title')
      || (typeof o.title == 'function' ? o.title.call($e[0]) :  o.title)

    return title
  }

  Tooltip.prototype.tip = function () {
    return this.$tip = this.$tip || $(this.options.template)
  }

  Tooltip.prototype.arrow = function () {
    return this.$arrow = this.$arrow || this.tip().find('.tooltip-arrow')
  }

  Tooltip.prototype.validate = function () {
    if (!this.$element[0].parentNode) {
      this.hide()
      this.$element = null
      this.options  = null
    }
  }

  Tooltip.prototype.enable = function () {
    this.enabled = true
  }

  Tooltip.prototype.disable = function () {
    this.enabled = false
  }

  Tooltip.prototype.toggleEnabled = function () {
    this.enabled = !this.enabled
  }

  Tooltip.prototype.toggle = function (e) {
    var self = e ? $(e.currentTarget)[this.type](this.getDelegateOptions()).data('bs.' + this.type) : this
    self.tip().hasClass('in') ? self.leave(self) : self.enter(self)
  }

  Tooltip.prototype.destroy = function () {
    clearTimeout(this.timeout)
    this.hide().$element.off('.' + this.type).removeData('bs.' + this.type)
  }


  // TOOLTIP PLUGIN DEFINITION
  // =========================

  var old = $.fn.tooltip

  $.fn.tooltip = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.tooltip')
      var options = typeof option == 'object' && option

      if (!data && option == 'destroy') return
      if (!data) $this.data('bs.tooltip', (data = new Tooltip(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.tooltip.Constructor = Tooltip


  // TOOLTIP NO CONFLICT
  // ===================

  $.fn.tooltip.noConflict = function () {
    $.fn.tooltip = old
    return this
  }

}(jQuery);

define("bootstrap-tooltip", function(){});

/* ========================================================================
 * Bootstrap: button.js v3.1.1
 * http://getbootstrap.com/javascript/#buttons
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  

  // BUTTON PUBLIC CLASS DEFINITION
  // ==============================

  var Button = function (element, options) {
    this.$element  = $(element)
    this.options   = $.extend({}, Button.DEFAULTS, options)
    this.isLoading = false
  }

  Button.DEFAULTS = {
    loadingText: 'loading...'
  }

  Button.prototype.setState = function (state) {
    var d    = 'disabled'
    var $el  = this.$element
    var val  = $el.is('input') ? 'val' : 'html'
    var data = $el.data()

    state = state + 'Text'

    if (!data.resetText) $el.data('resetText', $el[val]())

    $el[val](data[state] || this.options[state])

    // push to event loop to allow forms to submit
    setTimeout($.proxy(function () {
      if (state == 'loadingText') {
        this.isLoading = true
        $el.addClass(d).attr(d, d)
      } else if (this.isLoading) {
        this.isLoading = false
        $el.removeClass(d).removeAttr(d)
      }
    }, this), 0)
  }

  Button.prototype.toggle = function () {
    var changed = true
    var $parent = this.$element.closest('[data-toggle="buttons"]')

    if ($parent.length) {
      var $input = this.$element.find('input')
      if ($input.prop('type') == 'radio') {
        if ($input.prop('checked') && this.$element.hasClass('active')) changed = false
        else $parent.find('.active').removeClass('active')
      }
      if (changed) $input.prop('checked', !this.$element.hasClass('active')).trigger('change')
    }

    if (changed) this.$element.toggleClass('active')
  }


  // BUTTON PLUGIN DEFINITION
  // ========================

  var old = $.fn.button

  $.fn.button = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.button')
      var options = typeof option == 'object' && option

      if (!data) $this.data('bs.button', (data = new Button(this, options)))

      if (option == 'toggle') data.toggle()
      else if (option) data.setState(option)
    })
  }

  $.fn.button.Constructor = Button


  // BUTTON NO CONFLICT
  // ==================

  $.fn.button.noConflict = function () {
    $.fn.button = old
    return this
  }


  // BUTTON DATA-API
  // ===============

  $(document).on('click.bs.button.data-api', '[data-toggle^=button]', function (e) {
    var $btn = $(e.target)
    if (!$btn.hasClass('btn')) $btn = $btn.closest('.btn')
    $btn.button('toggle')
    e.preventDefault()
  })

}(jQuery);

define("bootstrap-button", function(){});

/* ========================================================================
 * Bootstrap: collapse.js v3.1.1
 * http://getbootstrap.com/javascript/#collapse
 * ========================================================================
 * Copyright 2011-2014 Twitter, Inc.
 * Licensed under MIT (https://github.com/twbs/bootstrap/blob/master/LICENSE)
 * ======================================================================== */


+function ($) {
  

  // COLLAPSE PUBLIC CLASS DEFINITION
  // ================================

  var Collapse = function (element, options) {
    this.$element      = $(element)
    this.options       = $.extend({}, Collapse.DEFAULTS, options)
    this.transitioning = null

    if (this.options.parent) this.$parent = $(this.options.parent)
    if (this.options.toggle) this.toggle()
  }

  Collapse.DEFAULTS = {
    toggle: true
  }

  Collapse.prototype.dimension = function () {
    var hasWidth = this.$element.hasClass('width')
    return hasWidth ? 'width' : 'height'
  }

  Collapse.prototype.show = function () {
    if (this.transitioning || this.$element.hasClass('in')) return

    var startEvent = $.Event('show.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    var actives = this.$parent && this.$parent.find('> .panel > .in')

    if (actives && actives.length) {
      var hasData = actives.data('bs.collapse')
      if (hasData && hasData.transitioning) return
      actives.collapse('hide')
      hasData || actives.data('bs.collapse', null)
    }

    var dimension = this.dimension()

    this.$element
      .removeClass('collapse')
      .addClass('collapsing')
      [dimension](0)

    this.transitioning = 1

    var complete = function () {
      this.$element
        .removeClass('collapsing')
        .addClass('collapse in')
        [dimension]('auto')
      this.transitioning = 0
      this.$element.trigger('shown.bs.collapse')
    }

    if (!$.support.transition) return complete.call(this)

    var scrollSize = $.camelCase(['scroll', dimension].join('-'))

    this.$element
      .one($.support.transition.end, $.proxy(complete, this))
      .emulateTransitionEnd(350)
      [dimension](this.$element[0][scrollSize])
  }

  Collapse.prototype.hide = function () {
    if (this.transitioning || !this.$element.hasClass('in')) return

    var startEvent = $.Event('hide.bs.collapse')
    this.$element.trigger(startEvent)
    if (startEvent.isDefaultPrevented()) return

    var dimension = this.dimension()

    this.$element
      [dimension](this.$element[dimension]())
      [0].offsetHeight

    this.$element
      .addClass('collapsing')
      .removeClass('collapse')
      .removeClass('in')

    this.transitioning = 1

    var complete = function () {
      this.transitioning = 0
      this.$element
        .trigger('hidden.bs.collapse')
        .removeClass('collapsing')
        .addClass('collapse')
    }

    if (!$.support.transition) return complete.call(this)

    this.$element
      [dimension](0)
      .one($.support.transition.end, $.proxy(complete, this))
      .emulateTransitionEnd(350)
  }

  Collapse.prototype.toggle = function () {
    this[this.$element.hasClass('in') ? 'hide' : 'show']()
  }


  // COLLAPSE PLUGIN DEFINITION
  // ==========================

  var old = $.fn.collapse

  $.fn.collapse = function (option) {
    return this.each(function () {
      var $this   = $(this)
      var data    = $this.data('bs.collapse')
      var options = $.extend({}, Collapse.DEFAULTS, $this.data(), typeof option == 'object' && option)

      if (!data && options.toggle && option == 'show') option = !option
      if (!data) $this.data('bs.collapse', (data = new Collapse(this, options)))
      if (typeof option == 'string') data[option]()
    })
  }

  $.fn.collapse.Constructor = Collapse


  // COLLAPSE NO CONFLICT
  // ====================

  $.fn.collapse.noConflict = function () {
    $.fn.collapse = old
    return this
  }


  // COLLAPSE DATA-API
  // =================

  $(document).on('click.bs.collapse.data-api', '[data-toggle=collapse]', function (e) {
    var $this   = $(this), href
    var target  = $this.attr('data-target')
        || e.preventDefault()
        || (href = $this.attr('href')) && href.replace(/.*(?=#[^\s]+$)/, '') //strip for ie7
    var $target = $(target)
    var data    = $target.data('bs.collapse')
    var option  = data ? 'toggle' : $this.data()
    var parent  = $this.attr('data-parent')
    var $parent = parent && $(parent)

    if (!data || !data.transitioning) {
      if ($parent) $parent.find('[data-toggle=collapse][data-parent="' + parent + '"]').not($this).addClass('collapsed')
      $this[$target.hasClass('in') ? 'addClass' : 'removeClass']('collapsed')
    }

    $target.collapse(option)
  })

}(jQuery);

define("bootstrap-collapse", function(){});

define('app',['require',
	'liveaddress',
	'./validate-address',
	'./email-subscribe',
	'./toggles',
	'./donate',
	'bootstrap-tooltip',
	'bootstrap-button',
	'bootstrap-collapse'
], function (require, liveaddress, validateAddress, emailSubscribe, toggles, donate) {
	

	$(document).ready(function() {
		liveaddress.init('5709446201813566380');
		validateAddress();
		emailSubscribe();
		toggles();
		donate();
	});

  /*  var app = {
        initialize: function () {
            // Your code here
        }
    };

    app.initialize();*/

});




require(["app"]);
