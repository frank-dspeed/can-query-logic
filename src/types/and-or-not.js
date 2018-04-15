var set = require("../set");
var assign = require("can-assign");
var arrayUnionIntersectionDifference = require("../array-union-intersection-difference");
var canReflect = require("can-reflect");
var canGet = require("can-key/get/get");
var canSymbol = require("can-symbol");

// Define the sub-types that BasicQuery will use
function AndKeys(values) {
    var vals = this.values = {};
    canReflect.eachKey(values, function(value, key){
        if(canReflect.isPlainObject(value) && !set.isSpecial(value)) {
            vals[key] = new AndKeys(value);
        } else {
            vals[key] = value;
        }
    });
}

var isMemberSymbol = canSymbol.for("can.isMember");


AndKeys.prototype.isMember = function(props, root, rootKey){
    var equal = true;
    var preKey = rootKey ? rootKey + "." : "";
    canReflect.eachKey(this.values, function(value, key){
        var isMember = value && (value[isMemberSymbol] || value.isMember);
        if(isMember) {
            if(!isMember.call(value, canGet(props,key), root || props, preKey+key) ) {
                equal = false;
            }
        } else {
            if(value !== canGet(props,key) ) {
                equal = false;
            }
        }
    });
    return equal;
};

function Or(values) {
    this.values = values;
}

Or.prototype.isMember = function(props){
    return this.values.some(function(value){
            return value && value.isMember ?
                value.isMember( props ) : value === props;
    });
};

function NotIdentity(value) {
    this.value = value;
}

// ====== DEFINE COMPARISONS ========

// Helpers ----------------------------
function checkIfUniversalAndReturnUniversal(setA) {
    return set.isEqual(setA, set.UNIVERSAL) ? set.UNIVERSAL : setA;
}

var MISSING = {};
function eachInUnique(a, acb, b, bcb, defaultReturn){
	var bCopy = assign({}, b),
		res;
	for (var prop in a) {
		res = acb(prop, a[prop], (prop in b) ? b[prop] : MISSING, a, b);
		if(res !== undefined) {
			return res;
		}
		delete bCopy[prop];
	}
	for (prop in bCopy) {
		res = bcb(prop, MISSING, b[prop], a, b);
		if(res !== undefined) {
			return res;
		}
	}
	return defaultReturn;
}

function keyDiff(valuesA, valuesB) {
	var keyResults = arrayUnionIntersectionDifference(
		Object.keys(valuesA),
		Object.keys(valuesB));
	return {
		aOnlyKeys: keyResults.difference,
		aAndBKeys: keyResults.intersection,
		bOnlyKeys:  arrayUnionIntersectionDifference(
			Object.keys(valuesB),
			Object.keys(valuesA)).difference
	};
}

function  notEmpty(value) {
	return value !== set.EMPTY;
}

// Difference of two ANDs is used two places
function difference(objA, objB){

    var valuesA = objA.values,
        valuesB = objB.values,
        diff = keyDiff(valuesA, valuesB),
        aOnlyKeys = diff.aOnlyKeys,
        aAndBKeys = diff.aAndBKeys,
        bOnlyKeys = diff.bOnlyKeys;

    // check if all aAndB are equal

    // With the shared keys, perform vA \ vB difference. If the DIFFERENCE is:
    // - EMPTY: vA has nothing outside vB. vA is equal or subset of vB.
    //   - IF sB has keys not in sA, the shared keys will be part of the result;
    //     OTHERWISE, if all empty, sA is subset of sB, EMPTY will be returned
    //                (even if sA has some extra own keys)
    // - NON-EMPTY: something in sA that is not in sB
    //   Now we need to figure out if it's "product-able" or not.
    //   Product-able -> some part of B is in A.
    //   Perform B ∩ A intersection.  INTERSECTION is:
    //   - EMPTY: NOT "product-able". DISJOINT.  Must return something.
    //   - non-EMPTY: Use to performa  product (in the future.)
    var sharedKeysAndValues = {},
        productAbleKeysAndData = {},
        disjointKeysAndValues = {};
    aAndBKeys.forEach(function(key){
        var difference = set.difference(valuesA[key], valuesB[key]);
        if(difference === set.EMPTY) {
            sharedKeysAndValues[key] = valuesA[key];
        } else {
            var intersection = set.intersection(valuesA[key], valuesB[key]);
            var isProductable = intersection !== set.EMPTY
            if(isProductable) {
                productAbleKeysAndData[key] = {
                    // Products with `difference U intersection` would be subtracted
                    // from produts with `intersection`
                    difference: difference,
                    intersection: intersection
                }
            } else {
                disjointKeysAndValues[key] = valuesA[key];
            }
        }
    });
    var productAbleKeys = Object.keys(productAbleKeysAndData);
    var singleProductKeyAndValue;
    if(productAbleKeys.length === 1) {
        singleProductKeyAndValue = {};
        singleProductKeyAndValue[productAbleKeys[0]] = productAbleKeysAndData[productAbleKeys[0]].difference;
    }

    // Now that we've got the shared keys organized
    // we can make decisions based on this information
    // and A-only and B-only keys.

    // if we have any disjoint keys, these sets can not intersect
    // {age: 21, ...} \ {age: 22, ...} ->  {age: 21, ...}
    if(Object.keys(disjointKeysAndValues).length) {
        return objA;
    }

    // contain all the same keys
    if((aOnlyKeys.length === 0) && (bOnlyKeys.length === 0)) {
        if(productAbleKeys.length > 1) {
            return set.UNDEFINABLE;
        }
        // {color: [RED, GREEN], ...X...} \ {color: [RED], ...X...} -> {color: [GREEN], ...X...}
        else if(productAbleKeys.length === 1){
            assign(sharedKeysAndValues, singleProductKeyAndValue);
            return new AndKeys(sharedKeysAndValues);
        } else {
            // {...X...} \ {...X...} -> EMPTY
            return set.EMPTY;
        }
    }
    // sA is likely a subset of sB
    if(aOnlyKeys.length > 0 && bOnlyKeys.length === 0) {
        if(productAbleKeys.length > 1) {
            return set.UNDEFINABLE;
        }
        // {age: 35, color: [RED, GREEN], ...X...} \ {color: [RED], ...X...} -> {age: 35, color: [GREEN], ...X...}
        else if(productAbleKeys.length === 1){
            assign(sharedKeysAndValues, singleProductKeyAndValue);
            aOnlyKeys.forEach(function(key){
                sharedKeysAndValues[key] = valuesA[key];
            });
            return new AndKeys(sharedKeysAndValues);
        } else {
            // sharedKeysAndValues
            return set.EMPTY;
        }
    }
    // sB is likely subset of sA
    // {}, {foo: "bar"} -> {foo: NOT("bar")}
    if(aOnlyKeys.length === 0 && bOnlyKeys.length > 0) {
        // Lets not figure out productAbleKeys right now.
        // Example:
        // {color: [RED, GREEN], ...X...}
        // \ {age: 35, color: [RED], ...X...}
        // = OR( {color: [GREEN], ...X...}, {age: NOT(35), color: [RED], ...X...} )
        if(productAbleKeys.length > 1) {
            return set.UNDEFINABLE;
        }
        var productAbleOr;
        if(productAbleKeys.length === 1) {
            // we add the intersection to the AND
            // the difference is the or
            var productableKey = productAbleKeys[0];
            productAbleOr = assign({},sharedKeysAndValues);
            productAbleOr[productableKey] = productAbleKeysAndData[productableKey].difference;
            sharedKeysAndValues[productableKey] = productAbleKeysAndData[productableKey].intersection;
        }

        var ands = bOnlyKeys.map(function(key){
            var shared = assign({},sharedKeysAndValues);
            var result = shared[key] = set.difference(set.UNIVERSAL, valuesB[key]);
            return result === set.EMPTY ? result : new AndKeys(shared);
        }).filter(notEmpty);

        if(productAbleOr) {
            ands.push(new AndKeys(productAbleOr))
        }

        // {c: "g"}
        // \ {c: "g", age: 22, name: "justin"}
        // = OR[ AND(name: NOT("justin"), c:"g"), AND(age: NOT(22), c: "g") ]
        if(ands.length > 1) {
            return new Or(ands);
        } else if(ands.length === 1) {
            // {c: "g"}
            // \ {c: "g", age: 22}
            // = AND(age: NOT(22), c: "g")
            return ands[0];
        } else {
            return set.EMPTY;
        }
    }

    // {name: "Justin"} \\ {age: 35} -> {name: "Justin", age: NOT(35)}
    if(aOnlyKeys.length > 0 && bOnlyKeys.length > 0) {
        if(productAbleKeys.length) {
            throw new Error("Can't handle any productable keys right now")
        }
        // add everything in sA into the result:
        aOnlyKeys.forEach(function(key){
            sharedKeysAndValues[key] = valuesA[key];
        });

        if(bOnlyKeys.length === 1) {
            // TODO: de-duplicate below
            var key = bOnlyKeys[0];
            var shared = assign({},sharedKeysAndValues);
            shared[key] = set.difference(set.UNIVERSAL,valuesB[key]);
            return new AndKeys(shared);
        }
        // {foo: "bar"} \\ {name: "Justin", age: 35} -> UNDEFINABLE
        else {
            return set.UNDEFINABLE;
        }

    }
}

// AndKeys comaprisons




set.defineComparison(AndKeys, AndKeys,{
    // {name: "Justin"} or {age: 35} -> new OR[{name: "Justin"},{age: 35}]
    // {age: 2} or {age: 3} -> {age: new OR[2,3]}
    // {age: 3, name: "Justin"} OR {age: 4} -> {age: 3, name: "Justin"} OR {age: 4}
    union: function(objA, objB){
        // first see if we can union a single property
        // {age: 21, color: ["R"]} U {age: 21, color: ["B"]} -> {age: 21, color: ["R","B"]}

        var diff = keyDiff(objA.values, objB.values);


        // find the different keys
        var aAndBKeysThatAreNotEqual = [],
            sameKeys= {};

        diff.aAndBKeys.forEach(function(key){
            if(!set.isEqual(objA.values[key], objB.values[key])) {
                aAndBKeysThatAreNotEqual.push(key)
            } else {
                sameKeys[key] = objA.values[key];
            }
        });

        // if all keys are shared
        if(!diff.aOnlyKeys.length && !diff.bOnlyKeys.length) {

            if(aAndBKeysThatAreNotEqual.length === 1) {
                var keyValue = aAndBKeysThatAreNotEqual[0];

                var result = sameKeys[keyValue] = set.union(objA.values[keyValue], objB.values[keyValue]);

                // if there is only one property, we can just return the universal set
                return canReflect.size(sameKeys) === 1 && set.isEqual(result, set.UNIVERSAL) ?
                    set.UNIVERSAL : new AndKeys(sameKeys);
            }  else if(aAndBKeysThatAreNotEqual.length === 0){
                // these things are equal
                return objA;
            }
        }
        // If everything shared is the same
        if(aAndBKeysThatAreNotEqual.length === 0 ) {
            // the set with the extra keys is a subset
            if( diff.aOnlyKeys.length > 0 && diff.bOnlyKeys.length === 0) {
                return checkIfUniversalAndReturnUniversal(objB);
            } else if( diff.aOnlyKeys.length === 0 && diff.bOnlyKeys.length > 0 ) {
                return checkIfUniversalAndReturnUniversal(objA);
            }
        }


        return new Or([objA, objB]);
    },
    // {foo: zed, abc: d}
    intersection: function(objA, objB){
        // combine all properties ... if the same property, try to take
        // an intersection ... if an intersection isn't possible ... freak out?
        var valuesA = objA.values,
            valuesB = objB.values,
            foundEmpty = false;
        var resultValues = {};
        eachInUnique(valuesA,
            function(prop, aVal, bVal){
                resultValues[prop] = bVal === MISSING ? aVal : set.intersection(aVal, bVal);
                if(resultValues[prop] === set.EMPTY) {
                    foundEmpty = true;
                }
            },
            valuesB,
            function(prop, aVal, bVal) {
                resultValues[prop] = bVal;
                if(resultValues[prop] === set.EMPTY) {
                    foundEmpty = true;
                }
            });
        if(foundEmpty) {
            return set.EMPTY;
        } else {
            return new AndKeys(resultValues);
        }

    },
    // A \ B -> what's in A, but not in B
    difference: difference
});

set.defineComparison(set.UNIVERSAL,AndKeys,{
    // A \ B -> what's in A, but not in B
    difference: function(universe, and){
        return difference({values: {}}, and);
    }
});


// Or comparisons
set.defineComparison(set.UNIVERSAL, Or,{
    difference: function(universal, or){
        return set.UNDEFINABLE;
    }
});


// Not comparisons ---------
var Identity = set.Identity;

// Only difference is needed w/ universal
set.defineComparison(set.UNIVERSAL, Identity,{
    // A \ B -> what's in b, but not in A
    difference: function(universe, value){
        return new NotIdentity(value);
    }
});

// Only difference is needed w/ universal
set.defineComparison(set.UNIVERSAL, NotIdentity,{
    // A \ B -> what's in b, but not in A
    difference: function(universe, not){
        return not.value;
    }
});

set.defineComparison(NotIdentity, NotIdentity,{
    /*
    // not 5 and not 6
    union: function(obj1, obj2){
        // must unroll the value

    },
    // {foo: zed, abc: d}
    intersection: function(obj1, obj2){

    },
    // A \ B -> what's in b, but not in A
    difference: function(obj1, obj2){

    }
    */
});



set.defineComparison(NotIdentity, Identity,{
    // not 5 and not 6
    union: function(not, primitive){
        // NOT(5) U 5
        if( set.isEqual( not.value, primitive) ) {
            return set.UNIVERSAL;
        }
        // NOT(4) U 6
        else {
            throw new Error("Not,Identity Union is not filled out");
        }
    },
    // {foo: zed, abc: d}
    intersection: function(not, primitive){
        return set.isEqual( !not.value, primitive ) ? primitive: set.EMPTY;
    },
    // A \ B -> what's in b, but not in A
    difference: function difference(not, primitive){
        // NOT(5) \ 3 -> UNDEFINABLE
        // NOT(3) \ 3 -> NOT(3)
        if(set.isEqual( not.value, primitive )) {
            return not;
        } else {
            return set.UNDEFINABLE;
        }
    }
});

set.defineComparison(Identity, NotIdentity,{
    difference: function(primitive, not){
        if(set.isEqual(primitive, not.value)) {
            return primitive;
        } else {
            return set.UNDEFINABLE;
        }
    }
});

module.exports = {
    AndKeys: AndKeys,
    Or: Or,
    Not: NotIdentity
};
