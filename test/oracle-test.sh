#!/bin/bash
# Runs test/sql-check.js on the Oracle that test/oracle-setup.sh installed (the other databases'
# scripts are only generated here). Any arguments go to it.
cd "$(dirname "$0")/.."
export ORACLE_HOME=/opt/oracle/product/23ai/dbhomeFree
SQLPLUS=$ORACLE_HOME/bin/sqlplus ORACLE_PWD=$(cat ~/.sqlviz-oracle) exec node test/sql-check.js "$@"
