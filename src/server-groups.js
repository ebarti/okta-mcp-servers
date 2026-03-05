/**
 * Server Groups — tag-to-server mapping
 *
 * Each key is a server name; the value is the list of OpenAPI tags
 * whose operations belong to that server.
 */

export const SERVER_GROUPS = {
    'okta-users': [
        'User', 'UserLifecycle', 'UserCred', 'UserFactor', 'UserGrant',
        'UserType', 'UserLinkedObject', 'UserOAuth', 'UserResources',
        'UserSessions', 'UserAuthenticatorEnrollments', 'UserClassification',
        'UserRisk', 'LinkedObject', 'Session', 'Group', 'GroupOwner', 'GroupRule',
    ],
    'okta-apps': [
        'Application', 'ApplicationConnections', 'ApplicationCrossAppAccessConnections',
        'ApplicationFeatures', 'ApplicationGrants', 'ApplicationGroups',
        'ApplicationLogos', 'ApplicationPolicies', 'ApplicationSSO',
        'ApplicationSSOCredentialKey', 'ApplicationSSOFederatedClaims',
        'ApplicationSSOPublicKeys', 'ApplicationTokens', 'ApplicationUsers',
        'OktaApplicationSettings', 'GroupPushMapping',
    ],
    'okta-authz': [
        'AuthorizationServer', 'AuthorizationServerAssoc',
        'AuthorizationServerClaims', 'AuthorizationServerClients',
        'AuthorizationServerKeys', 'AuthorizationServerPolicies',
        'AuthorizationServerRules', 'AuthorizationServerScopes',
        'OAuth2ResourceServerCredentialsKeys',
    ],
    'okta-idps': [
        'IdentityProvider', 'IdentityProviderKeys',
        'IdentityProviderSigningKeys', 'IdentityProviderUsers',
        'IdentitySource',
    ],
    'okta-security': [
        'Authenticator', 'Policy', 'AttackProtection', 'Behavior',
        'DeviceAssurance', 'DevicePostureCheck', 'ThreatInsight',
        'NetworkZone', 'CAPTCHA', 'WebAuthnPreregistration',
    ],
    'okta-roles': [
        'RoleAssignmentAUser', 'RoleAssignmentBGroup', 'RoleAssignmentClient',
        'RoleBTargetAdmin', 'RoleBTargetBGroup', 'RoleBTargetClient',
        'RoleCResourceSet', 'RoleCResourceSetResource',
        'RoleDResourceSetBinding', 'RoleDResourceSetBindingMember',
        'RoleECustom', 'RoleECustomPermission', 'GovernanceBundle',
    ],
    'okta-customization': [
        'Brands', 'Themes', 'CustomPages', 'CustomTemplates', 'CustomDomain',
        'EmailCustomization', 'EmailDomain', 'EmailServer', 'Template',
        'AssociatedDomainCustomizations', 'UISchema', 'Schema', 'ProfileMapping',
    ],
    'okta-org': [
        'OrgSettingAdmin', 'OrgSettingCommunication', 'OrgSettingContact',
        'OrgSettingCustomization', 'OrgSettingGeneral', 'OrgSettingMetadata',
        'OrgSettingSupport', 'OktaPersonalSettings', 'OrgCreator',
        'Feature', 'TrustedOrigin', 'RateLimitSettings', 'PrincipalRateLimit',
        'ApiToken', 'ApiServiceIntegrations',
    ],
    'okta-hooks': [
        'EventHook', 'InlineHook', 'HookKey', 'LogStream', 'SystemLog',
        'Subscription', 'SSFReceiver', 'SSFSecurityEventToken', 'SSFTransmitter',
    ],
    'okta-devices': [
        'Device', 'DeviceIntegrations', 'AgentPools', 'DirectoriesIntegration',
        'Realm', 'RealmAssignment', 'PushProvider', 'ServiceAccount',
    ],
};

/** Human-readable descriptions for each server */
export const SERVER_DESCRIPTIONS = {
    'okta-users': 'Users, Groups, Sessions, Factors, Credentials',
    'okta-apps': 'Applications, App SSO, App Users/Groups, Provisioning',
    'okta-authz': 'Authorization Servers, Policies, Rules, Claims, Scopes',
    'okta-idps': 'Identity Providers, IdP Keys, Identity Sources',
    'okta-security': 'Authenticators, Policies, Behavior, Network Zones, CAPTCHA',
    'okta-roles': 'Role Assignments, Targets, Resource Sets, Custom Roles',
    'okta-customization': 'Brands, Themes, Custom Pages/Templates, Schemas, Emails',
    'okta-org': 'Org Settings, Features, Trusted Origins, Rate Limits, API Tokens',
    'okta-hooks': 'Event/Inline Hooks, Log Streams, System Log, SSF',
    'okta-devices': 'Devices, Agent Pools, Realms, Push Providers',
};
