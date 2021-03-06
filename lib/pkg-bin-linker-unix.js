"use strict";

/* eslint-disable global-require */

const Fs = require("fs");
const logger = require("./logger");
const PkgBinLinkerBase = require("./pkg-bin-linker-base");

//
// Look at each promoted package and link their bin
//

class PkgBinLinker extends PkgBinLinkerBase {
  constructor(options) {
    super(options);
  }

  //
  // Platform specific
  //

  _ensureGoodLink(symlink, target) {
    try {
      const existTarget = Fs.readlinkSync(symlink);
      if (existTarget === target) {
        return true;
      }
    } catch (err) {
      //
    }

    this._rmBinLink(symlink);

    return false;
  }

  _chmod(target) {
    try {
      Fs.accessSync(target, Fs.constants.X_OK);
      return;
    } catch (e) {
      //
    }

    try {
      Fs.chmodSync(target, "0755");
    } catch (err) {
      logger.error(`bin-linker: chmod on ${target} failed`, err.message);
    }
  }

  _generateBinLink(relTarget, symlink) {
    Fs.symlinkSync(relTarget, symlink);
  }

  _rmBinLink(symlink) {
    this._unlinkFile(symlink);
  }

  _readBinLinks() {
    return Fs.readdirSync(this._binDir);
  }
}

module.exports = PkgBinLinker;
