#!/bin/bash
# Installs Oracle Database 23ai Free, for test/sql-check.js, on Oracle Linux 8 (x86_64 or aarch64).
# It only comes for Oracle Linux and Red Hat, so it gets its own machine; the other four
# databases are in test/linux-setup.sh (Ubuntu).
#
#     sudo bash test/oracle-setup.sh       # once; Oracle's own setup takes a quarter of an hour
#     bash test/oracle-test.sh             # then, any number of times
#
# The SYSTEM password is made up here and kept in ~/.sqlviz-oracle for the user who ran sudo.
set -euxo pipefail

who=${SUDO_USER:-$USER}
home=$(getent passwd "$who" | cut -d: -f6)

dnf install -y oracle-database-preinstall-23ai
dnf module -y reset nodejs && dnf module -y enable nodejs:20 # the default, 10, is too old for the test
dnf install -y nodejs && dnf distro-sync -y nodejs
if ! rpm -q oracle-database-free-23ai >/dev/null; then
  curl -fsSL "https://download.oracle.com/otn-pub/otn_software/db-free/oracle-database-free-23ai-1.0-1.el8.$(uname -m).rpm" -o /tmp/oracle-free.rpm
  dnf install -y /tmp/oracle-free.rpm
fi

if [ ! -s "$home/.sqlviz-oracle" ]; then
  # letters and digits only: it goes on sqlplus's command line
  echo "Sv$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')9" > "$home/.sqlviz-oracle"
  chown "$who" "$home/.sqlviz-oracle"
  chmod 600 "$home/.sqlviz-oracle"
fi
if [ ! -e /opt/oracle/oradata/FREE ]; then
  pw=$(cat "$home/.sqlviz-oracle")
  printf '%s\n%s\n' "$pw" "$pw" | /etc/init.d/oracle-free-23ai configure
fi
systemctl enable --now oracle-free-23ai
