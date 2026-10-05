#!/bin/bash
#
# electron-builder's own after-remove script, plus the AppArmor profile that
# build/linux/after-install.sh installs - and safe across upgrades.
#
# This also runs when the package is upgraded, and for an rpm it runs after the
# new version's after-install has already finished: rpm installs the new files,
# runs their %post, and only then removes the old ones. Deleting the link and
# the profile then would undo the install that just happened, and the app would
# abort again after the next reboot. So nothing happens unless the package is
# really going away: dpkg says `remove` or `purge`, rpm says 0.
case "$1" in
    remove|purge|0) ;;
    *) exit 0 ;;
esac

# --remove takes the alternative that was registered, not the link to it.
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' || true
else
    rm -f '/usr/bin/${executable}'
fi

profile_target='/etc/apparmor.d/${executable}'
if [ -f "$profile_target" ]; then
    # Unload it first, or the kernel keeps it until the next reboot.
    if apparmor_status --enabled >/dev/null 2>&1 && ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
        apparmor_parser --remove "$profile_target" >/dev/null 2>&1 || true
    fi
    rm -f "$profile_target"
fi

exit 0
