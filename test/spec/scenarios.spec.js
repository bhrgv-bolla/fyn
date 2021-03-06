"use strict";

const Fs = require("fs");
const Path = require("path");
const _ = require("lodash");
const Yaml = require("js-yaml");
const Promise = require("bluebird");
const rimraf = require("rimraf");
const dirTree = require("../dir-tree");
const fynRun = require("../../cli/fyn");
const fyntil = require("../../lib/util/fyntil");
const logger = require("../../lib/logger");
const mockNpm = require("../fixtures/mock-npm");
const optionalRequire = require("optional-require")(require);

const BASE_ARGS = ["--pg=none", "-q=none", "--no-rcfile"];
const getFynDirArg = dir => `--fyn-dir=${dir}`;

function readJson(path) {
  try {
    return JSON.parse(Fs.readFileSync(path).toString());
  } catch (e) {
    return {};
  }
}

describe("scenario", function() {
  let server;
  const saveExit = fyntil.exit;
  let registry;
  before(() => {
    fyntil.exit = code => {
      throw new Error(`exit ${code}`);
    };
    return mockNpm({ port: 0, logLevel: "warn" }).then(s => {
      server = s;
      registry = `http://localhost:${server.info.port}`;
    });
  });

  after(done => {
    fyntil.exit = saveExit;
    server.stop(done);
  });

  beforeEach(() => {
    logger._items = [];
    logger._itemOptions = {};
    logger._lines = [];
    logger._logData = [];
  });

  const nulStepAction = {
    before: _.noop,
    after: _.noop,
    verify: _.noop
  };

  function executeScenario(cwd, stopStep) {
    const pkgJsonFile = Path.join(cwd, "package.json");
    const pkgJson = {};
    const files = Fs.readdirSync(cwd).filter(x => x.startsWith("step-"));

    const cleanLock = lock => {
      _.each(lock, pkg => {
        _.each(pkg, (vpkg, ver) => {
          if (ver === "_") return;
          vpkg.$ = "test";
          vpkg._ = vpkg._.replace(/:[0-9]+\//, "/");
        });
      });

      return lock;
    };

    const verifyLock = stepDir => {
      const expectLockFile = Path.join(stepDir, "lock.yaml");
      if (Fs.existsSync(expectLockFile)) {
        const actualLockFile = Path.join(cwd, "fyn-lock.yaml");
        const expectLock = Yaml.safeLoad(Fs.readFileSync(expectLockFile).toString());
        const actualLock = Yaml.safeLoad(Fs.readFileSync(actualLockFile).toString());
        expect(cleanLock(actualLock), "lock file should match").to.deep.equal(
          cleanLock(expectLock)
        );
      }
    };

    const makeStep = step => {
      const stepDir = Path.join(cwd, step);
      const stepAction = optionalRequire(Path.join(stepDir), { default: {} });
      _.defaults(stepAction, nulStepAction);
      const stepTitle = stepAction.title ? `: ${stepAction.title}` : "";

      it(`${step}${stepTitle}`, () => {
        return Promise.try(() => stepAction.before())
          .then(() => {
            const pkg = readJson(Path.join(stepDir, "pkg.json"));
            _.merge(pkgJson, pkg);
            Fs.writeFileSync(pkgJsonFile, JSON.stringify(pkgJson, null, 2));

            const fynDir = Path.join(cwd, ".fyn");
            if (stepAction.run) {
              return stepAction.run({
                registry,
                fynDir,
                cwd,
                baseArgs: BASE_ARGS,
                pkgJson,
                pkgJsonFile
              });
            }

            const args = [].concat(`--reg=${registry}`, BASE_ARGS, getFynDirArg(fynDir), [
              `--cwd=${cwd}`,
              "install"
            ]);

            return fynRun(args).catch(err => {
              if (err.message !== "exit 0") throw err;
            });
          })
          .then(() => {
            const nmTree = dirTree.make(cwd, "node_modules");
            const expectNmTree = Yaml.safeLoad(
              Fs.readFileSync(Path.join(stepDir, "nm-tree.yaml")).toString()
            );
            expect(nmTree).to.deep.equal(expectNmTree);
            verifyLock(stepDir);
          })
          .then(() => stepAction.verify())
          .finally(() => stepAction.after());
      });
    };

    for (const step of files.sort()) {
      if (step === stopStep) break;
      makeStep(step);
    }
  }

  const cleanUp = true;
  const filter = {
    // "locked-change-major": { stopStep: "step-03" }
    // "bin-linker": { stopStep: "" }
  };

  const saveCwd = process.cwd();
  const scenarioDir = Path.join(__dirname, "../scenarios");
  const scenarios = Fs.readdirSync(scenarioDir).filter(x => !x.startsWith("."));
  scenarios.sort().forEach(s => {
    if (_.isEmpty(filter) || filter[s]) {
      const f = filter[s] || {};
      describe(s, function() {
        const cwd = Path.join(scenarioDir, s);
        const clean = () => {
          rimraf.sync(Path.join(cwd, "package.json"));
          rimraf.sync(Path.join(cwd, "fyn-lock.yaml"));
          rimraf.sync(Path.join(cwd, ".fyn"));
          rimraf.sync(Path.join(cwd, "node_modules"));
        };

        before(clean);

        if (cleanUp) {
          after(clean);
        }

        afterEach(() => {
          process.chdir(saveCwd);
        });

        return executeScenario(cwd, f.stopStep);
      });
    }
  });
});
