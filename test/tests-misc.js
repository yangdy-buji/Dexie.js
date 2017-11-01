import Dexie from 'dexie';
import {module, stop, start, asyncTest, equal, ok, deepEqual} from 'QUnit';
import {resetDatabase, spawnedTest, promisedTest} from './dexie-unittest-utils';

const async = Dexie.async;

var db = new Dexie("TestIssuesDB");
db.version(1).stores({
    users: "id,first,last,&username,*&email,*pets",
    keyless: ",name",
    foo: "id",
    docs: "id,title,*words"
    // If required for your test, add more tables here
});

module("misc", {
    setup: () => {
        stop();
        resetDatabase(db).catch(e => {
            ok(false, "Error resetting database: " + e.stack);
        }).finally(start);
    },
    teardown: () => {
    }
});

//
// Misc Tests
//

promisedTest("Simple writing hook", async ()=>{
    db.docs.hook('writing', doc => {
        return {
            ...doc,
            words: `${doc.title || ''} ${doc.content || ''}`.toLowerCase().split(' ')};
    });

    // Table.put()
    await db.docs.put({id: "home", title: "The home page", content: "Here is my presentation of myself..."});
    // Table.bulkPut()
    await db.docs.bulkPut([{id: "2017-11-01", title: "Another day...", content: "This was another day in my life"}]);
    // Table.add()
    await db.docs.add({id: "2017-11-02", title: "Day 2", content: "Nothing, really!"});
    // Table.bulkAdd()
    await db.docs.bulkAdd([{id: "2017-11-03", title: "Day 3", content: "Nothing today either..."}]);
    
    const allDocs = await db.docs.toArray();
    const cherryPicked = allDocs.map(doc => [doc.id, doc.words]);
    deepEqual(cherryPicked[0], 
        ["2017-11-01", ["another", "day...", "this", "was", "another", "day", "in", "my", "life"]], "Table.put() calls writing hook");
    deepEqual(cherryPicked[1], 
        ["2017-11-02", ["day", "2", "nothing,", "really!"]], "Table.bulkPut() calls writing hook");
    deepEqual(cherryPicked[2],
        ["2017-11-03", ["day", "3", "nothing", "today", "either..."]], "Table.add() calls writing hook");
    deepEqual(cherryPicked[3],
        ["home", ["the", "home", "page", "here", "is", "my", "presentation", "of", "myself..."]], "Table.bulkAdd() calls writing hook");
    // Table.update()
    await db.docs.update("home", {title: "My home page!"});
    const homeDoc = await db.docs.get("home");
    deepEqual(homeDoc.words, ["my", "home", "page!", "here", "is", "my", "presentation", "of", "myself..."], "Table.update() calls writing hook");

    // Collection.modify()
    await db.docs.where({title: "Day 2"}).modify({title: "Next day"});
    const day2Doc = await db.docs.get("2017-11-02");
    deepEqual(day2Doc.words, ["next", "day", "nothing,", "really!"], "Collection.modify() calls writing hook");
});

asyncTest("Adding object with falsy keys", function () {
    db.keyless.add({ name: "foo" }, 1).then(function (id) {
        equal(id, 1, "Normal case ok - Object with key 1 was successfully added.")
        return db.keyless.add({ name: "bar" }, 0);
    }).then(function (id) {
        equal(id, 0, "Could add a numeric falsy value (0)");
        return db.keyless.add({ name: "foobar" }, "");
    }).then(function (id) {
        equal(id, "", "Could add a string falsy value ('')");
        return db.keyless.put({ name: "bar2" }, 0);
    }).then(function (id) {
        equal(id, 0, "Could put a numeric falsy value (0)");
        return db.keyless.put({ name: "foobar2" }, "");
    }).then(function (id) {
        equal(id, "", "Could put a string falsy value ('')");
    }).catch(function (e) {
        ok(false, e);
    }).finally(start);
});

asyncTest("#102 Passing an empty array to anyOf throws exception", async(function* () {
    try {
        let count = yield db.users.where("username").anyOf([]).count();
        equal(count, 0, "Zarro items matched the query anyOf([])");
    } catch (err) {
        ok(false, "Error when calling anyOf([]): " + err);
    } finally {
        start();
    }
}));

spawnedTest("#248 'modifications' object in 'updating' hook can be bizarre", function*() {
    var numCreating = 0,
        numUpdating = 0;
    function CustomDate (realDate) {
        this._year = new Date(realDate).getFullYear();
        this._month = new Date(realDate).getMonth();
        this._day = new Date(realDate).getDate();
        this._millisec = new Date(realDate).getTime();
        //...
    }
    
    function creatingHook (primKey, obj) {
        ++numCreating;
        var date = obj.date;
        if (date && date instanceof CustomDate) {
            obj.date = new Date(date._year, date._month, date._day);
        }
    }
    function updatingHook (modifications, primKey, obj) {
        ++numUpdating;
        var date = modifications.date;
        if (date && date instanceof CustomDate) {
            return {date: new Date(date._year, date._month, date._day)};
        }
    }
    function isDate(obj) {
        // obj instanceof Date does NOT work with Safari when Date are retrieved from IDB.
        return obj.getTime && obj.getDate && obj.getFullYear;
    }
    function readingHook (obj) {
        if (obj.date && isDate(obj.date)) {
            obj.date = new CustomDate(obj.date);
        }
        return obj;
    }
    
    db.foo.hook('creating', creatingHook);
    db.foo.hook('reading', readingHook);
    db.foo.hook('updating', updatingHook);
    var testDate = new CustomDate(new Date(2016, 5, 11));
    equal(testDate._year, 2016, "CustomDate has year 2016");
    equal(testDate._month, 5, "CustomDate has month 5");
    equal(testDate._day, 11, "CustomDate has day 11");
    var testDate2 = new CustomDate(new Date(2016, 5, 12));
    try {
        db.foo.add ({id: 1, date: testDate});
        
        var retrieved = yield db.foo.get(1);
        
        ok(retrieved.date instanceof CustomDate, "Got a CustomDate object when retrieving object");
        equal (retrieved.date._day, 11, "The CustomDate is on day 11");
        db.foo.put ({id: 1, date: testDate2});
        
        retrieved = yield db.foo.get(1);
        
        ok(retrieved.date.constructor === CustomDate, "Got a CustomDate object when retrieving object");
        equal (retrieved.date._day, 12, "The CustomDate is now on day 12");
        
        // Check that hooks has been called expected number of times
        equal(numCreating, 1, "creating hook called once");
        equal(numUpdating, 1, "updating hook called once");
    } finally {
        db.foo.hook('creating').unsubscribe(creatingHook);
        db.foo.hook('reading').unsubscribe(readingHook);
        db.foo.hook('updating').unsubscribe(updatingHook);
    }
});

asyncTest("Issue: Broken Promise rejection #264", 1, function () {
    db.open().then(()=>{
        return db.users.where('id')
            .equals('does-not-exist')
            .first()
    }).then(function(result){
        return Promise.reject(undefined);
    }).catch(function (err) {
        equal(err, undefined, "Should catch the rejection");
    }).then(res => {
        start();
    }).catch(err => {
        start();
    });
});

asyncTest ("#323 @gitawego's post. Should not fail unexpectedly on readonly properties", function(){
    class Foo {
        get synced() { return false;}
    }

    db.foo.mapToClass(Foo);
    
    db.transaction('rw', db.foo, function () {
      db.foo.put({id:1});
      db.foo.where('id').equals(1).modify({
        synced: true
      });
    }).catch (e => {
        ok(false, "Could not update it: " + (e.stack || e));
    }).then (() => {
        ok(true, "Could update it");
        return db.foo.get(1);
    }).then (foo => {
        return db.foo.get(1);        
    }).then (foo=>{
        console.log("Wow, it could get it even though it's mapped to a class that forbids writing that property.");
    }).catch(e => {
        ok(true, `Got error from get: ${e.stack || e}`);
    }).then(() => {
        return db.foo.toArray();
    }).then(array => {
        console.log(`Got array of length: ${array.length}`);
    }).catch(e => {
        ok(true, `Got error from toArray: ${e.stack || e}`);
        return db.foo.each(item => console.log(item));
    }).then(array => {
        console.log(`Could do each`);
    }).catch(e => {
        ok(true, `Got error from each(): ${e.stack || e}`);
        return db.foo.toCollection().sortBy('synced');
    }).then(array => {
        console.log(`Could do sortBy`);
    }).catch(e => {
        ok(true, `Got error from sortBy(): ${e.stack || e}`);
    }).finally(start);
    
});

spawnedTest ("#360 DB unresponsive after multiple Table.update() or Collection.modify()", function* () {
    const NUM_UPDATES = 2000;
    let result = yield db.transaction('rw', db.foo, function* () {
        yield db.foo.put({id: 1, value: 0});
        for (var i=0;i<NUM_UPDATES;++i) {
            db.foo.where('id').equals(1).modify(item => ++item.value);
        }
        return yield db.foo.get(1);
    });
    equal(result.value, NUM_UPDATES, `Should have updated id 1 a ${NUM_UPDATES} times`);
});