module.exports = class Sourcer {

    #items;
    #prioritizedItems = []
    #maxItems;
    #repeatCopy;
    #repeatable;
    #historySourcer;
    #historySourcerHashFunc;

    constructor(items = [], max = undefined, repeat = false) {
        this.#items = Array.isArray(items) ? items : [];
        this.#maxItems = max;
        if (this.#repeatable = repeat) {
            this.#repeatCopy = new Sourcer();
        }
        this.add = this.add.bind(this);
        this.next = this.next.bind(this);
        this.stillHas = this.stillHas.bind(this);
        this.return = this.return.bind(this);
    }
    
    static generatorOrNull(...items) {
        let elements;
        if (!items || items.length == 0 || ((elements = items.filter(e => e && e != null)).length <= 0)) {
            return null;
        }
        return new Sourcer(elements).asGenerator();
    }

    get count() {
        return this.#prioritizedItems.length + this.#items.length;
    }

    enableHistory(historyFunc) {
        if (this.#repeatable) {
            throw new Error(`history cannot be enabled in repeatable sourcers.`);
        }
        else if (typeof historyFunc !== 'function') {
            throw new Error(`history requires a hash function`);
        }
        this.#historySourcerHashFunc = historyFunc;
        this.#historySourcer = new Sourcer();
    }

    add(item) {
        if (item == undefined || !['function', 'object', 'string'].some(t => t == typeof item)) {
            throw new Error(`invalid item.`)
        }
        if (this.#maxItems && (this.count + 1 > this.#maxItems))
            return;

        this.#items.push(item);
    }

    addUnique(item) {
        if (this.has(e => item == e)) {
            return;
        }
        return this.add(item);
    }

    prioritize(item) {
        if (item == undefined || !['function', 'object'].some(t => t == typeof item)) {
            throw new Error(`invalid item.`)
        }
        if (this.#maxItems && (this.count + 1 > this.#maxItems))
            return;
        this.#prioritizedItems.unshift(item);
    }

    remove(item) {
        this.#items = this.#items.filter(s => s != item);
    }

    removePredicate(predicate) {
        if (typeof predicate == 'function') {
            let originalLength = this.#items.length;
            this.#items = this.#items.filter(s => !predicate(s));
            return originalLength - this.#items.length;
        }
        return 0;
    }

    asGenerator(predicate) {
        const getCount = () => this.count;
        return {
            generator: this.#asGenerator(predicate),
            count: predicate ? this.countOf.bind(this, predicate) : getCount.bind(this),
            isLast: (() => this.last() == undefined).bind(this)
        }
    }

    next(predicate) {
        let _return, _next = this.#next(predicate);
        if (_next != undefined) {
            _return = _next;
        }
        else if (this.#repeatable) {
            this.#items = this.#repeatCopy.popAll();
            _return = this.#next(predicate);
        }
        _return && this.#historySourcer && this.#historySourcer.add(this.#historySourcerHashFunc(_return));
        _return && this.#repeatable && this.#repeatCopy.add(_return);
        return _return;
    }

    popAll() {
        const copy = this.#items.slice();
        this.#items = [];
        return copy;
    }

    clear() {
        this.#items = [];
    }

    last() {
        return this.#items[this.count - 1];
    }

    first() {
        return this.#items[0];
    }

    stillHas() {
        return this.#prioritizedItems.length > 0 || this.#items.length > 0 || (this.#repeatable && this.#repeatCopy.stillHas());
    }

    countOf(predicate) {
        return this.#items.filter(predicate).length;
    }

    stillHasPredicate(predicate) {
        return this.#prioritizedItems.filter(predicate).length > 0 || this.#items.filter(predicate).length > 0 || (this.#repeatable && this.#repeatCopy.stillHasPredicate(predicate));
    }

    has(predicate) {
        if (typeof predicate == 'function') {
            return this.#prioritizedItems.filter(predicate).length > 0 || this.#items.some(i => predicate(i)) || (this.#repeatable && this.#repeatCopy.has(predicate));
        }
        return false;
    }

    had(itemOrPredicate) {
        if (!this.#historySourcer) {
            return false;
        }
        else if (typeof itemOrPredicate == 'function') {
            return this.#historySourcer.has(itemOrPredicate);
        }
        return this.#historySourcer.#items.some(e => this.#historySourcerHashFunc(e) == itemOrPredicate) || this.#historySourcer.#items.includes(itemOrPredicate);
    }

    return(items) {
        if (!Array.isArray(items)) {
            items = [items];
        }
        this.#items.unshift(...items)
    }

    clone() {
        return new Sourcer(this.#items.slice(), this.#maxItems, this.#repeatable);
    }

    serialize(serializeActivity) {
        const items = this.#items.slice().filter(i => !!i).map(item => serializeActivity(item).toString('hex'));
        return JSON.stringify({ items, max: this.#maxItems });
    }

    * #asGenerator(predicate) {
        const stillHas = () => predicate ? this.stillHasPredicate(predicate) : this.stillHas();
        while (stillHas()) {
            yield this.next(predicate);
        }
        return;
    }

    #next(predicate = undefined) {
        if (!predicate) {
            if (this.#prioritizedItems.length > 0) {
                return this.#prioritizedItems.shift();
            }
            return this.#items.shift();
        }
        return this.#nextByPredicate(predicate);
    }

    #nextByPredicate(predicate) {
        let arrRef = this.#prioritizedItems, index = this.#prioritizedItems.findIndex(predicate);
        if (index < 0) {
            arrRef = this.#items;
            index = this.#items.findIndex(predicate);
        }
        if (index >= 0) {
            let ref = arrRef[index];
            arrRef.splice(index, 1);
            return ref;
        }
    }
}