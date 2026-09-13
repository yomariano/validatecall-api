# Historical E2E scenarios

The XML files in this directory describe manual test scenarios and sample inputs. They are
not an executable automated test suite, and some expectations refer to the old Supabase
architecture. There is no `test:e2e` runner for these files.

The current executable regression suite lives in `tests/` and `config/*.test.js`:

```sh
npm test -- --runInBand
```

For a browser smoke test, use an isolated test database and test Google OAuth client. Check
sign-in, CSV import and reload, campaign create/details, branding save/upload, mobile
navigation, and logout. Keep outbound workers disabled and use provider test credentials or
mocks to avoid contacting leads. Test web research's missing-key error as well as sourced
results; never interpret sample contacts in these fixtures as real lead data.
